<script lang="ts">
  import type { Question, AskUserQuestionInput } from "../stores/orchestrator";
  import { orchestratorQueue } from "../stores/orchestrator";
  import { sessions } from "../stores/sessions";
  import { sendResponse } from "../utils/outputParser";

  // Show all requests from all terminals
  $: requests = $orchestratorQueue;
  $: pendingCount = requests.length;
  $: allSessions = $sessions;
  // Only show sessions where Claude is running
  $: claudeSessions = allSessions.filter(s => s.claudeRunning);
  // Show shell sessions separately (no status displayed)
  $: shellSessions = allSessions.filter(s => !s.claudeRunning);

  function handleOptionClick(request: AskUserQuestionInput, optionIndex: number) {
    // Send response immediately
    sendResponse(request.sessionId, optionIndex);
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "active": return "working";
      case "waiting": return "waiting";
      case "idle": return "idle";
      case "error": return "error";
      case "shell": return "shell";
      default: return "connecting";
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case "active": return "Working...";
      case "waiting": return "Waiting for input";
      case "idle": return "Ready";
      case "error": return "Error";
      case "shell": return "Shell";
      default: return "Connecting...";
    }
  }
</script>

{#if pendingCount > 0}
  <!-- Queue of all pending questions -->
  <div class="orchestrator">
    <div class="header">
      <div class="header-left">
        <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <span class="title">Pending Permissions</span>
        <span class="badge">{pendingCount}</span>
      </div>
    </div>

    <div class="requests-list">
      {#each requests as request (request.id)}
        {@const question = request.questions[0]}
        <div class="request-card">
          <div class="request-header">
            <span class="session-tag">{request.sessionName}</span>
            <span class="request-time">{new Date(request.timestamp).toLocaleTimeString()}</span>
          </div>

          <div class="request-question">{question.question}</div>

          <div class="request-options">
            {#each question.options as option, idx}
              <button
                class="option-btn"
                class:primary={idx === 0}
                onclick={() => handleOptionClick(request, idx)}
              >
                <span class="option-num">{idx + 1}</span>
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="orchestrator">
    {#if claudeSessions.length > 0}
      <div class="header">
        <div class="header-left">
          <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          <span class="title">Claude Sessions</span>
          <span class="badge">{claudeSessions.length}</span>
        </div>
      </div>

      <div class="sessions-list">
        {#each claudeSessions as session (session.id)}
          <div class="session-card" class:working={session.status === "active"}>
            <div class="session-info">
              <span class="session-name">{session.name}</span>
              <span class="session-cwd">{session.cwd}</span>
            </div>
            <div class="session-status" class:active={session.status === "active"} class:idle={session.status === "idle"} class:error={session.status === "error"}>
              <span class="status-dot {session.status}"></span>
              <span class="status-label">{getStatusLabel(session.status)}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if shellSessions.length > 0}
      <div class="header" class:mt-12={claudeSessions.length > 0}>
        <div class="header-left">
          <svg class="icon shell" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <span class="title">Shell Sessions</span>
          <span class="badge shell">{shellSessions.length}</span>
        </div>
      </div>

      <div class="sessions-list">
        {#each shellSessions as session (session.id)}
          <div class="session-card shell">
            <div class="session-info">
              <span class="session-name">{session.name}</span>
              <span class="session-cwd">{session.cwd}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if allSessions.length > 0}
      <div class="info-footer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>Permission requests will appear here</span>
      </div>
    {:else}
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        <div class="empty-text">
          <span class="empty-title">No active terminals</span>
          <span class="empty-desc">Start a Claude session to begin</span>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .orchestrator {
    background: var(--bg-secondary);
    padding: 12px;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .orchestrator.empty {
    justify-content: center;
    align-items: center;
    gap: 24px;
  }

  .empty-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-secondary);
  }

  .empty-text {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .empty-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .empty-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .status-bar {
    display: flex;
    gap: 16px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .status-dot.idle {
    background: var(--text-secondary);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon {
    color: var(--accent);
    flex-shrink: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .badge {
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 10px;
  }

  .requests-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }

  .request-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .request-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .session-tag {
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .request-time {
    font-size: 10px;
    color: var(--text-secondary);
  }

  .request-question {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .request-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option-btn {
    display: flex;
    align-items: center;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.12s ease;
    text-align: left;
    width: 100%;
  }

  .option-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .option-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg-primary);
  }

  .option-btn.primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--bg-primary);
  }

  .option-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 10px;
    flex-shrink: 0;
  }

  .option-btn.primary .option-num {
    background: rgba(0,0,0,0.2);
  }

  /* Session status styles */
  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    overflow-y: auto;
  }

  .session-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .session-card.working {
    border-color: var(--success);
  }

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .session-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .session-cwd {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .session-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 12px;
    background: var(--bg-secondary);
  }

  .session-status.active {
    background: rgba(63, 185, 80, 0.15);
  }

  .session-status.error {
    background: rgba(248, 81, 73, 0.15);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.active {
    background: var(--success);
    animation: pulse 1.5s infinite;
  }

  .status-dot.idle {
    background: var(--text-secondary);
  }

  .status-dot.connecting {
    background: var(--warning);
    animation: pulse 1s infinite;
  }

  .status-dot.error {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .session-status.active .status-label {
    color: var(--success);
  }

  .session-status.error .status-label {
    color: var(--error);
  }

  .info-footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    margin-top: auto;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .header.mt-12 {
    margin-top: 12px;
  }

  .icon.shell {
    color: var(--text-secondary);
  }

  .badge.shell {
    background: var(--text-secondary);
  }

  .session-card.shell {
    opacity: 0.7;
  }
</style>
