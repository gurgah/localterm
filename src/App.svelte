<script lang="ts">
  import { onMount } from "svelte";
  import Terminal from "./lib/components/Terminal.svelte";
  import Orchestrator from "./lib/components/Orchestrator.svelte";
  import { sessions, activeSessionId } from "./lib/stores/sessions";
  import { getHomeDir, isTauri } from "./lib/utils/tauri";

  interface Tile {
    id: string;
    type: "orchestrator" | "terminal";
    sessionId?: string;
    expanded: boolean;
    autoStart?: boolean; // Auto-run "claude" command
  }

  let tiles: Tile[] = [
    { id: "orchestrator", type: "orchestrator", expanded: false },
    { id: "tile-1", type: "terminal", expanded: false },
    { id: "tile-2", type: "terminal", expanded: false },
    { id: "tile-3", type: "terminal", expanded: false },
  ];

  let expandedTile: string | null = null;

  async function initSession(tileId: string, autoStart: boolean = true) {
    const tile = tiles.find(t => t.id === tileId);
    if (!tile || tile.type !== "terminal" || tile.sessionId) return;

    const home = isTauri() ? await getHomeDir() : "~";
    const cwd = home || "~";
    const name = `claude-${tiles.filter(t => t.sessionId).length + 1}`;
    const sessionId = sessions.add(name, cwd);

    tiles = tiles.map(t =>
      t.id === tileId ? { ...t, sessionId, autoStart } : t
    );
    activeSessionId.set(sessionId);
  }

  function toggleExpand(tileId: string) {
    if (expandedTile === tileId) {
      expandedTile = null;
    } else {
      expandedTile = tileId;
    }
  }

  function addTile() {
    const newId = `tile-${Date.now()}`;
    tiles = [...tiles, { id: newId, type: "terminal", expanded: false }];
  }

  function removeTile(tileId: string) {
    const tile = tiles.find(t => t.id === tileId);
    if (tile?.sessionId) {
      sessions.remove(tile.sessionId);
    }
    // Reset expanded state if removing the expanded tile
    if (expandedTile === tileId) {
      expandedTile = null;
    }
    tiles = tiles.filter(t => t.id !== tileId);
  }

  function selectTile(tileId: string) {
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

  $: gridLayout = getGridLayout(tiles.length + (tiles.length < 12 ? 1 : 0)); // +1 for add button
  $: gridStyle = `grid-template-columns: repeat(${gridLayout.cols}, 1fr); grid-template-rows: repeat(${gridLayout.rows}, 1fr);`;

  // Get terminal tiles only (excluding orchestrator)
  $: terminalTiles = tiles.filter(t => t.type === "terminal");

  // Find active tile index
  function getActiveTileIndex(): number {
    return terminalTiles.findIndex(t => t.sessionId && $activeSessionId === t.sessionId);
  }

  // Select tile by index (0-based, terminal tiles only)
  function selectTileByIndex(index: number) {
    if (index >= 0 && index < terminalTiles.length) {
      const tile = terminalTiles[index];
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

  // Close active tile
  function closeActiveTile() {
    const activeTile = terminalTiles.find(t => t.sessionId && $activeSessionId === t.sessionId);
    if (activeTile) {
      removeTile(activeTile.id);
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
      const activeTile = tiles.find(t => t.sessionId && $activeSessionId === t.sessionId);
      if (activeTile) {
        toggleExpand(activeTile.id);
      }
      return;
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  });
</script>

<div class="app">
  <div class="titlebar" data-tauri-drag-region></div>
  <div class="grid" class:has-expanded={expandedTile !== null} style={gridStyle}>
    {#each tiles as tile (tile.id)}
      {@const isExpanded = expandedTile === tile.id}
      {@const isHidden = expandedTile !== null && !isExpanded}

      <div
        class="tile"
        class:expanded={isExpanded}
        class:hidden={isHidden}
        class:orchestrator={tile.type === "orchestrator"}
        class:terminal={tile.type === "terminal"}
        class:active={tile.sessionId && $activeSessionId === tile.sessionId}
        onclick={() => tile.sessionId && activeSessionId.set(tile.sessionId)}
        role="button"
        tabindex="0"
      >
        <div class="tile-header">
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
              <span>{tile.sessionId ? $sessions.find(s => s.id === tile.sessionId)?.name : "Click to start"}</span>
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
              <button class="tile-btn close" onclick={() => removeTile(tile.id)} title="Close">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            {/if}
          </div>
        </div>

        <div class="tile-content">
          {#if tile.type === "orchestrator"}
            <Orchestrator />
          {:else if tile.sessionId}
            {@const session = $sessions.find(s => s.id === tile.sessionId)}
            <Terminal sessionId={tile.sessionId} sessionName={session?.name || "Terminal"} cwd={session?.cwd || "~"} autoStart={tile.autoStart} />
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

    {#if tiles.length < 12}
      <button class="add-tile" onclick={addTile}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    {/if}
  </div>
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
  }


  .grid {
    display: grid;
    gap: 8px;
    height: calc(100% - 36px);
    margin-top: 36px;
    transition: all 0.2s ease;
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

  .add-tile {
    background: var(--bg-secondary);
    border: 2px dashed var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .add-tile:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--bg-tertiary);
  }

  /* Responsive grid - adjust columns based on tile count */
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
  }
</style>
