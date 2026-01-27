<script lang="ts">
  import type { AskUserQuestionInput } from "../stores/orchestrator";
  import { orchestratorQueue } from "../stores/orchestrator";
  import { sessions } from "../stores/sessions";
  import { sendPermissionResponse } from "../services/permissionHandler";

  $: requests = $orchestratorQueue;
  $: pendingCount = requests.length;
  $: allSessions = $sessions;
  $: claudeSessions = allSessions.filter(s => s.claudeRunning);
  $: shellSessions = allSessions.filter(s => !s.claudeRunning);

  function handleOptionClick(request: AskUserQuestionInput, optionIndex: number) {
    sendPermissionResponse(request.sessionId, optionIndex);
    orchestratorQueue.resolve(request.id);
  }
</script>

<div class="orchestrator">
  {#if pendingCount > 0}
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

    <div class="list">
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
              <button class="option-btn" class:primary={idx === 0} onclick={() => handleOptionClick(request, idx)}>
                <span class="option-num">{idx + 1}</span>
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if claudeSessions.length > 0}
    <div class="header" class:mt-12={pendingCount > 0}>
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

    <div class="list">
      {#each claudeSessions as session (session.id)}
        <div class="session-card">
          <div class="session-info">
            <span class="session-name">{session.name}</span>
            <span class="session-cwd">{session.cwd}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if shellSessions.length > 0}
    <div class="header" class:mt-12={claudeSessions.length > 0 || pendingCount > 0}>
      <div class="header-left">
        <svg class="icon shell" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        <span class="title">Shell Sessions</span>
        <span class="badge shell">{shellSessions.length}</span>
      </div>
    </div>

    <div class="list">
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

  {#if allSessions.length === 0 && pendingCount === 0}
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

<style>
  .orchestrator {
    background: var(--bg-secondary);
    height: 100%;
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .header.mt-12 {
    margin-top: 12px;
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

  .icon.shell {
    color: var(--text-secondary);
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

  .badge.shell {
    background: var(--text-secondary);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
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

  .session-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .session-card.shell {
    opacity: 0.7;
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

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 150px;
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
</style>
