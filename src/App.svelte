<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import Terminal from "./lib/components/Terminal.svelte";
  import Orchestrator from "./lib/components/Orchestrator.svelte";
  import { sessions, activeSessionId } from "./lib/stores/sessions";
  import { settings } from "./lib/stores/settings";
  import { getHomeDir, isTauri } from "./lib/utils/tauri";
  import { listen, emit } from "@tauri-apps/api/event";
  import { exit } from "@tauri-apps/plugin-process";
  import { open } from "@tauri-apps/plugin-dialog";
  import { open as openUrl } from "@tauri-apps/plugin-shell";

  interface Tile {
    id: string;
    type: "orchestrator" | "terminal";
    sessionId?: string;
    expanded: boolean;
    minimized: boolean;
    autoStart?: boolean; // Auto-run "claude" command
  }

  let tiles: Tile[] = [
    { id: "orchestrator", type: "orchestrator", expanded: false, minimized: false },
    { id: "tile-1", type: "terminal", expanded: false, minimized: false },
    { id: "tile-2", type: "terminal", expanded: false, minimized: false },
    { id: "tile-3", type: "terminal", expanded: false, minimized: false },
  ];

  let expandedTile: string | null = null;
  let contextMenu: { x: number; y: number; tileId: string } | null = null;
  let confirmCloseTile: string | null = null; // Tile awaiting close confirmation
  let showQuitConfirm: boolean = false; // Quit app confirmation
  let activeTileId: string | null = "tile-1"; // Track active tile (even without session)
  let editingSessionId: string | null = null; // Session being renamed
  let editingName: string = ""; // Current edit value

  // Platform detection for keyboard shortcut labels
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl+";

  async function initSession(tileId: string, autoStart: boolean = true) {
    const tile = tiles.find(t => t.id === tileId);
    if (!tile || tile.type !== "terminal" || tile.sessionId) return;

    // Use default location from settings if set, otherwise fall back to home
    const currentSettings = get(settings);
    let cwd: string;

    if (currentSettings.defaultLocation) {
      cwd = currentSettings.defaultLocation;
    } else {
      const home = isTauri() ? await getHomeDir() : "~";
      cwd = home || "~";
    }

    const name = `claude-${tiles.filter(t => t.sessionId).length + 1}`;
    const sessionId = sessions.add(name, cwd);

    tiles = tiles.map(t =>
      t.id === tileId ? { ...t, sessionId, autoStart } : t
    );
    activeTileId = tileId; // Set as active tile
    activeSessionId.set(sessionId);
  }

  function toggleExpand(tileId: string) {
    if (expandedTile === tileId) {
      expandedTile = null;
    } else {
      expandedTile = tileId;
    }
    // Force terminals to re-fit after CSS transition completes
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 500);
  }

  function addTile() {
    // Max 12 tiles total (including orchestrator)
    if (tiles.length >= 12) return;

    const newId = `tile-${Date.now()}`;
    tiles = [...tiles, { id: newId, type: "terminal", expanded: false, minimized: false }];
    activeTileId = newId; // Set as active immediately
    // Don't auto-init - let user choose Claude or Command Line
  }

  function minimizeTile(tileId: string) {
    if (expandedTile === tileId) {
      expandedTile = null;
    }
    tiles = tiles.map(t => t.id === tileId ? { ...t, minimized: true } : t);
  }

  function askCloseTile(tileId: string) {
    const tile = tiles.find(t => t.id === tileId);
    // If no session started, close directly without confirmation
    if (!tile?.sessionId) {
      removeTile(tileId);
      return;
    }
    confirmCloseTile = tileId;
  }

  function confirmClose() {
    if (confirmCloseTile) {
      const tileToRemove = confirmCloseTile;
      confirmCloseTile = null; // Clear first to hide overlay before removal
      removeTile(tileToRemove);
    }
  }

  function cancelClose() {
    confirmCloseTile = null;
  }

  // Quit app with confirmation
  function askQuit() {
    showQuitConfirm = true;
  }

  async function confirmQuit() {
    showQuitConfirm = false;
    if (isTauri()) {
      await exit(0);
    }
  }

  function cancelQuit() {
    showQuitConfirm = false;
  }

  // Rename session functions
  function startRename(sessionId: string, currentName: string) {
    editingSessionId = sessionId;
    editingName = currentName;
  }

  function saveRename() {
    if (editingSessionId && editingName.trim()) {
      const trimmedName = editingName.trim().slice(0, 20); // Max 20 chars
      sessions.setName(editingSessionId, trimmedName);
    }
    editingSessionId = null;
    editingName = "";
  }

  function cancelRename() {
    editingSessionId = null;
    editingName = "";
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function restoreTile(tileId: string) {
    tiles = tiles.map(t => t.id === tileId ? { ...t, minimized: false } : t);
    activeTileId = tileId; // Set as active
    const tile = tiles.find(t => t.id === tileId);
    if (tile?.sessionId) {
      activeSessionId.set(tile.sessionId);
    }
  }

  function removeTile(tileId: string) {
    const tile = tiles.find(t => t.id === tileId);

    // Clear expanded state first
    if (expandedTile === tileId) {
      expandedTile = null;
    }

    // Find the next tile to activate BEFORE removing
    let nextActiveTileId: string | null = null;
    if (activeTileId === tileId) {
      const remainingTerminals = tiles.filter(t => t.id !== tileId && t.type === "terminal" && !t.minimized);
      // Select the last one (most recent) instead of first
      nextActiveTileId = remainingTerminals.length > 0 ? remainingTerminals[remainingTerminals.length - 1].id : null;
    }

    // Remove from tiles array first
    tiles = tiles.filter(t => t.id !== tileId);

    // Then remove session (this will dispose the terminal)
    if (tile?.sessionId) {
      sessions.remove(tile.sessionId);
    }

    // Now set the new active tile
    if (activeTileId === tileId) {
      activeTileId = nextActiveTileId;
      // Also update activeSessionId
      if (nextActiveTileId) {
        const nextTile = tiles.find(t => t.id === nextActiveTileId);
        if (nextTile?.sessionId) {
          activeSessionId.set(nextTile.sessionId);
        }
      }
    }

    contextMenu = null;
  }

  function showContextMenu(e: MouseEvent, tileId: string) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY, tileId };
  }

  function hideContextMenu() {
    contextMenu = null;
  }

  function selectTile(tileId: string) {
    activeTileId = tileId; // Always set active tile
    const tile = tiles.find(t => t.id === tileId);
    if (tile?.sessionId) {
      activeSessionId.set(tile.sessionId);
    }
  }

  // Calculate grid layout based on tile count
  function getGridLayout(count: number): { cols: number; rows: number } {
    if (count <= 1) return { cols: 1, rows: 1 };
    if (count <= 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 9) return { cols: 3, rows: 3 };
    return { cols: 4, rows: 3 };
  }

  $: gridLayout = getGridLayout(visibleTiles.length);
  $: gridStyle = `grid-template-columns: repeat(${gridLayout.cols}, 1fr); grid-template-rows: repeat(${gridLayout.rows}, 1fr);`;

  // Get terminal tiles only (excluding orchestrator)
  $: terminalTiles = tiles.filter(t => t.type === "terminal");

  // Find active tile index
  function getActiveTileIndex(): number {
    return terminalTiles.findIndex(t => t.id === activeTileId);
  }

  // Select tile by index (0-based, terminal tiles only)
  function selectTileByIndex(index: number) {
    if (index >= 0 && index < terminalTiles.length) {
      const tile = terminalTiles[index];
      activeTileId = tile.id; // Set active tile
      if (tile.sessionId) {
        activeSessionId.set(tile.sessionId);
      } else {
        // Auto-init if not started
        initSession(tile.id, true);
      }
    }
  }

  // Navigate to previous/next tile
  function navigateTile(direction: "prev" | "next") {
    const currentIndex = getActiveTileIndex();
    let newIndex: number;

    if (currentIndex === -1) {
      newIndex = 0;
    } else if (direction === "prev") {
      newIndex = (currentIndex - 1 + terminalTiles.length) % terminalTiles.length;
    } else {
      newIndex = (currentIndex + 1) % terminalTiles.length;
    }

    selectTileByIndex(newIndex);
  }

  // Close active tile with confirmation (Cmd+W)
  function closeActiveTile() {
    if (activeTileId) {
      const activeTile = terminalTiles.find(t => t.id === activeTileId && !t.minimized);
      if (activeTile) {
        askCloseTile(activeTile.id);
      }
    }
  }

  // Keyboard shortcuts handler
  function handleKeydown(e: KeyboardEvent) {
    const isMeta = e.metaKey || e.ctrlKey;

    if (!isMeta) return;

    // Cmd+1-9: Select tile by index
    if (e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      selectTileByIndex(parseInt(e.key) - 1);
      return;
    }

    // Cmd+T: New tile
    if (e.key === "t") {
      e.preventDefault();
      addTile();
      return;
    }

    // Cmd+W: Close active tile
    if (e.key === "w") {
      e.preventDefault();
      closeActiveTile();
      return;
    }

    // Cmd+[: Previous tile
    if (e.key === "[") {
      e.preventDefault();
      navigateTile("prev");
      return;
    }

    // Cmd+]: Next tile
    if (e.key === "]") {
      e.preventDefault();
      navigateTile("next");
      return;
    }

    // Cmd+Enter: Toggle expand active tile
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeTileId) {
        toggleExpand(activeTileId);
      }
      return;
    }

    // Cmd+= or Cmd++: Increase font size
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      settings.increaseFontSize();
      return;
    }

    // Cmd+-: Decrease font size
    if (e.key === "-") {
      e.preventDefault();
      settings.decreaseFontSize();
      return;
    }

    // Cmd+0: Reset font size
    if (e.key === "0") {
      e.preventDefault();
      settings.resetFontSize();
      return;
    }

    // Cmd+Q: Quit app with confirmation
    if (e.key === "q") {
      e.preventDefault();
      askQuit();
      return;
    }
  }

  // Get showOrchestrator from settings
  $: showOrchestrator = $settings.showOrchestrator;
  $: activeTiles = tiles.filter(t => !t.minimized);
  $: visibleTiles = showOrchestrator ? activeTiles : activeTiles.filter(t => t.type !== "orchestrator");
  $: minimizedTiles = tiles.filter(t => t.minimized && t.type === "terminal");

  // Update menu when default location changes
  async function updateMenuLocation(path: string) {
    if (isTauri()) {
      await emit("update-default-location", path);
    }
  }

  // Sync orchestrator visibility to menu checkbox
  async function syncOrchestratorMenu(show: boolean) {
    if (isTauri()) {
      await emit("update-show-orchestrator", show);
    }
  }

  onMount(async () => {
    window.addEventListener("keydown", handleKeydown);

    // Send initial settings to menu
    const initialSettings = get(settings);
    await updateMenuLocation(initialSettings.defaultLocation);
    await syncOrchestratorMenu(initialSettings.showOrchestrator);

    // Listen for menu events from Rust
    const unlistenDefaultLocation = await listen("menu-default-location", async () => {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Default Location",
      });
      if (selected && typeof selected === "string") {
        settings.setDefaultLocation(selected);
        await updateMenuLocation(selected);
      }
    });

    const unlistenToggleOrchestrator = await listen("menu-toggle-orchestrator", async () => {
      const newValue = !get(settings).showOrchestrator;
      settings.setShowOrchestrator(newValue);
      await syncOrchestratorMenu(newValue);
    });

    const unlistenNewTerminal = await listen("menu-new-terminal", () => {
      addTile();
    });

    const unlistenCloseTerminal = await listen("menu-close-terminal", () => {
      closeActiveTile();
    });

    const unlistenReportBug = await listen("menu-report-bug", async () => {
      const subject = encodeURIComponent("LocalTerm Bug Report");
      const body = encodeURIComponent("Please describe the bug:\n\n\nSteps to reproduce:\n1. \n2. \n3. \n\n");
      await openUrl(`mailto:melih@aleonis.co?subject=${subject}&body=${body}`);
    });

    // Handle Cmd+Q / window close request from Rust
    const unlistenQuit = await listen("request-quit", () => {
      askQuit();
    });

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      unlistenDefaultLocation();
      unlistenToggleOrchestrator();
      unlistenNewTerminal();
      unlistenCloseTerminal();
      unlistenReportBug();
      unlistenQuit();
    };
  });
</script>

<svelte:window on:click={hideContextMenu} />

<div class="app">
  <div class="titlebar" data-tauri-drag-region>
    {#if visibleTiles.length < 12}
      <button class="titlebar-add" onclick={addTile} title="New Terminal ({modKey}T)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    {/if}
  </div>
  <div class="grid" class:has-expanded={expandedTile !== null} style={gridStyle}>
    {#each visibleTiles as tile (tile.id)}
      {@const isExpanded = expandedTile === tile.id}
      {@const isHidden = expandedTile !== null && !isExpanded}

      <div
        class="tile"
        class:expanded={isExpanded}
        class:hidden={isHidden}
        class:orchestrator={tile.type === "orchestrator"}
        class:terminal={tile.type === "terminal"}
        class:active={tile.type === "terminal" && activeTileId === tile.id}
        role="button"
        tabindex="0"
      >
        <div
          class="tile-header"
          onclick={() => selectTile(tile.id)}
          oncontextmenu={(e) => tile.type === "terminal" && showContextMenu(e, tile.id)}
        >
          <div class="tile-title">
            {#if tile.type === "orchestrator"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"></path>
              </svg>
              <span>Orchestrator</span>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              {#if tile.sessionId && editingSessionId === tile.sessionId}
                <input
                  type="text"
                  class="rename-input"
                  bind:value={editingName}
                  maxlength="20"
                  onkeydown={handleRenameKeydown}
                  onblur={saveRename}
                  onclick={(e) => e.stopPropagation()}
                  autofocus
                />
              {:else}
                <span
                  class="session-name"
                  ondblclick={(e) => {
                    e.stopPropagation();
                    if (tile.sessionId) {
                      const session = $sessions.find(s => s.id === tile.sessionId);
                      if (session) startRename(tile.sessionId, session.name);
                    }
                  }}
                >{tile.sessionId ? $sessions.find(s => s.id === tile.sessionId)?.name : "Click to start"}</span>
              {/if}
            {/if}
          </div>
          <div class="tile-actions">
            <button class="tile-btn" onclick={() => toggleExpand(tile.id)} title={isExpanded ? "Minimize" : "Maximize"}>
              {#if isExpanded}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="4 14 10 14 10 20"></polyline>
                  <polyline points="20 10 14 10 14 4"></polyline>
                  <line x1="14" y1="10" x2="21" y2="3"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>
              {/if}
            </button>
            {#if tile.type === "terminal"}
              <button class="tile-btn close" onclick={() => askCloseTile(tile.id)} title="Close">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            {/if}
          </div>
        </div>

        <div class="tile-content" onclick={() => selectTile(tile.id)}>
          {#if confirmCloseTile === tile.id}
            <div class="close-overlay" onclick={(e) => e.stopPropagation()}>
              <div class="close-modal">
                <p>Close this terminal?</p>
                <div class="close-actions">
                  <button class="close-btn cancel" onclick={(e) => { e.stopPropagation(); cancelClose(); }}>Cancel</button>
                  <button class="close-btn confirm" onclick={(e) => { e.stopPropagation(); confirmClose(); }}>Close</button>
                </div>
              </div>
            </div>
          {/if}
          {#if tile.type === "orchestrator"}
            <Orchestrator />
          {:else if tile.sessionId}
            {@const session = $sessions.find(s => s.id === tile.sessionId)}
            <Terminal sessionId={tile.sessionId} sessionName={session?.name || "Terminal"} cwd={session?.cwd || "~"} autoStart={tile.autoStart} fontSize={$settings.fontSize} />
          {:else}
            <div class="empty-terminal">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              <div class="start-options">
                <button class="start-btn primary" onclick={() => initSession(tile.id, true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Start Claude
                </button>
                <button class="start-btn secondary" onclick={() => initSession(tile.id, false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                  Command Line
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/each}

  </div>

  {#if minimizedTiles.length > 0}
    <div class="minimized-bar">
      {#each minimizedTiles as tile (tile.id)}
        {@const session = $sessions.find(s => s.id === tile.sessionId)}
        <button
          class="minimized-tile"
          onclick={() => restoreTile(tile.id)}
          oncontextmenu={(e) => showContextMenu(e, tile.id)}
          title={session?.name || "Terminal"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <span>{session?.name || "Terminal"}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if contextMenu}
    <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
      <button class="context-item" onclick={() => restoreTile(contextMenu.tileId)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
        Restore
      </button>
      <div class="context-divider"></div>
      <button class="context-item danger" onclick={() => removeTile(contextMenu.tileId)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        Exit
      </button>
    </div>
  {/if}

  {#if showQuitConfirm}
    <div class="quit-overlay" onclick={cancelQuit}>
      <div class="quit-modal" onclick={(e) => e.stopPropagation()}>
        <p>Quit LocalTerm?</p>
        <span class="quit-subtitle">All terminal sessions will be closed.</span>
        <div class="quit-actions">
          <button class="quit-btn cancel" onclick={cancelQuit}>Cancel</button>
          <button class="quit-btn confirm" onclick={confirmQuit}>Quit</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    height: 100vh;
    width: 100vw;
    background: var(--bg-primary);
    padding: 8px;
    padding-top: 8px;
    box-sizing: border-box;
    overflow: hidden;
    position: relative;
  }

  .titlebar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 36px;
    background: var(--bg-primary);
    -webkit-app-region: drag;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 12px;
  }

  .titlebar-add {
    -webkit-app-region: no-drag;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .titlebar-add:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
    color: var(--accent);
  }


  .grid {
    display: grid;
    gap: 8px;
    height: calc(100% - 36px);
    margin-top: 36px;
    transition: all 0.2s ease;
  }

  .app:has(.minimized-bar) .grid {
    height: calc(100% - 36px - 40px); /* Account for minimized bar */
  }

  .grid.has-expanded {
    grid-template-columns: 1fr !important;
    grid-template-rows: 1fr !important;
  }

  .tile {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    transition: all 0.2s ease;
  }

  .tile.hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    opacity: 0;
    pointer-events: none;
  }

  .tile.expanded {
    position: absolute;
    top: 44px; /* Below traffic lights */
    left: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 10;
  }

  .tile.orchestrator {
    border-color: var(--accent);
  }

  .tile.active {
    border-color: var(--success);
  }

  .tile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border);
    -webkit-app-region: drag;
  }

  .tile-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
  }

  .tile.orchestrator .tile-title {
    color: var(--accent);
  }

  .tile.active .tile-title {
    color: var(--success);
  }

  .session-name {
    cursor: default;
    -webkit-app-region: no-drag;
  }

  .session-name:hover {
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .rename-input {
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: inherit;
    font-size: inherit;
    font-weight: inherit;
    font-family: inherit;
    padding: 2px 6px;
    width: 120px;
    max-width: 150px;
    outline: none;
    -webkit-app-region: no-drag;
  }

  .rename-input:focus {
    border-color: var(--success);
  }

  .tile-actions {
    display: flex;
    gap: 4px;
    -webkit-app-region: no-drag;
  }

  .tile-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .tile-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .tile-btn.close:hover {
    color: var(--error);
  }

  .tile-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .empty-terminal {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .start-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 160px;
  }

  .start-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .start-btn.primary {
    background: var(--accent);
    border: none;
    color: var(--bg-primary);
  }

  .start-btn.primary:hover {
    background: var(--accent-hover);
  }

  .start-btn.secondary {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .start-btn.secondary:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }


  /* Close confirmation overlay */
  .close-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20;
    backdrop-filter: blur(4px);
  }

  .close-modal {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    text-align: center;
  }

  .close-modal p {
    margin: 0 0 16px 0;
    color: var(--text-primary);
    font-size: 14px;
  }

  .close-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .close-btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn.cancel {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .close-btn.cancel:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .close-btn.confirm {
    background: var(--error);
    border: none;
    color: white;
  }

  .close-btn.confirm:hover {
    background: #dc2626;
  }

  /* Quit confirmation overlay */
  .quit-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(8px);
  }

  .quit-modal {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px 32px;
    text-align: center;
  }

  .quit-modal p {
    margin: 0 0 8px 0;
    color: var(--text-primary);
    font-size: 16px;
    font-weight: 500;
  }

  .quit-subtitle {
    display: block;
    margin-bottom: 20px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .quit-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .quit-btn {
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .quit-btn.cancel {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .quit-btn.cancel:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .quit-btn.confirm {
    background: var(--error);
    border: none;
    color: white;
  }

  .quit-btn.confirm:hover {
    background: #dc2626;
  }

  /* Minimized bar at bottom */
  .minimized-bar {
    position: absolute;
    bottom: 8px;
    left: 8px;
    right: 8px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    z-index: 50;
  }

  .minimized-tile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .minimized-tile:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  /* Context menu */
  .context-menu {
    position: fixed;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    min-width: 140px;
    z-index: 1000;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }

  .context-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.1s ease;
    text-align: left;
  }

  .context-item:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .context-item.danger:hover {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error);
  }

  .context-divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  /* Responsive grid - adjust columns based on tile count */
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
  }
</style>
