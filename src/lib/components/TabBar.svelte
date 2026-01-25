<script lang="ts">
  import { sessions, activeSessionId, type Session } from "../stores/sessions";
  import { getHomeDir, closeSession as closePtySession, isTauri } from "../utils/tauri";

  function statusColor(status: Session["status"]): string {
    switch (status) {
      case "active": return "var(--success)";
      case "waiting": return "var(--warning)";
      case "error": return "var(--error)";
      case "connecting": return "var(--accent)";
      default: return "var(--text-secondary)";
    }
  }

  function selectSession(id: string) {
    activeSessionId.set(id);
  }

  async function closeSession(e: MouseEvent, id: string) {
    e.stopPropagation();

    // Close PTY if Tauri
    if (isTauri()) {
      try {
        await closePtySession(id);
      } catch (e) {
        console.error("Failed to close PTY:", e);
      }
    }

    sessions.remove(id);

    // Select another session if active was closed
    const remaining = $sessions.filter(s => s.id !== id);
    if ($activeSessionId === id && remaining.length > 0) {
      activeSessionId.set(remaining[0].id);
    } else if (remaining.length === 0) {
      activeSessionId.set(null);
    }
  }

  async function addSession() {
    const home = isTauri() ? await getHomeDir() : "~";
    const cwd = home || "~";
    const name = `session-${$sessions.length + 1}`;
    const id = sessions.add(name, cwd);
    activeSessionId.set(id);
  }

  // Auto-create first session
  $: if ($sessions.length === 0 && typeof window !== 'undefined') {
    addSession();
  }
</script>

<div class="tabbar">
  <div class="tabs">
    {#each $sessions as session (session.id)}
      <div
        class="tab"
        class:active={$activeSessionId === session.id}
        onclick={() => selectSession(session.id)}
        onkeydown={(e) => e.key === 'Enter' && selectSession(session.id)}
        role="tab"
        tabindex="0"
      >
        <span class="status" style="background: {statusColor(session.status)}"></span>
        <span class="name">{session.name}</span>
        <span
          class="close"
          onclick={(e) => closeSession(e, session.id)}
          onkeydown={(e) => e.key === 'Enter' && closeSession(e, session.id)}
          role="button"
          tabindex="0"
        >×</span>
      </div>
    {/each}
    <button class="tab add" onclick={addSession}>+</button>
  </div>
  <button class="settings">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
    </svg>
  </button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 0 8px 0 78px; /* Left padding for macOS traffic lights */
    height: 40px;
    -webkit-app-region: drag;
  }

  .tabs {
    display: flex;
    gap: 2px;
    -webkit-app-region: no-drag;
    overflow-x: auto;
    max-width: calc(100% - 50px);
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--tab-inactive);
    border: none;
    border-radius: 6px 6px 0 0;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--tab-active);
    color: var(--text-primary);
  }

  .tab .status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tab .close {
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 0 4px;
    opacity: 0;
    transition: opacity 0.15s;
    border-radius: 3px;
  }

  .tab:hover .close {
    opacity: 1;
  }

  .tab .close:hover {
    color: var(--error);
  }

  .tab.add {
    background: transparent;
    color: var(--text-secondary);
    font-size: 16px;
    padding: 6px 10px;
    border: none;
  }

  .tab.add:hover {
    color: var(--accent);
    background: transparent;
  }

  .settings {
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px;
    -webkit-app-region: no-drag;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: all 0.15s ease;
  }

  .settings:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
</style>
