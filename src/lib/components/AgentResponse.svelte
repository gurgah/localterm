<script lang="ts">
  import { ToolType } from "../agents/types";

  export let tool: ToolType = ToolType.TEXT;
  export let content: string = "";
  export let command: string | undefined = undefined;
  export let sessionName: string = "";
  export let onRun: (command: string) => void = () => {};
  export let onDismiss: () => void = () => {};

  let collapsed = false;

  function copyText(text: string) {
    navigator.clipboard.writeText(text).catch(console.error);
  }

  $: isBash = tool === ToolType.BASH;
  $: displayCommand = command ?? content;
</script>

<div class="agent-response" class:bash={isBash}>
  <div class="header">
    <div class="header-left">
      {#if isBash}
        <span class="tool-tag bash">BASH</span>
      {:else}
        <span class="tool-tag text">TEXT</span>
      {/if}
      {#if sessionName}
        <span class="session-name">{sessionName}</span>
      {/if}
    </div>
    {#if content.length > 80}
      <button class="collapse-btn" onclick={() => collapsed = !collapsed}>
        {collapsed ? '+' : '-'}
      </button>
    {/if}
  </div>

  {#if !collapsed}
    <div class="body">
      {#if isBash}
        <code class="command-block">{displayCommand}</code>
        {#if command && content !== command}
          <div class="explanation">{content}</div>
        {/if}
      {:else}
        <div class="text-content">{content}</div>
      {/if}
    </div>
  {/if}

  <div class="actions">
    {#if isBash}
      <button class="action-btn run" onclick={() => onRun(displayCommand)} title="Run in terminal">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Run
      </button>
      <button class="action-btn copy" onclick={() => copyText(displayCommand)} title="Copy command">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    {/if}
    <button class="action-btn dismiss" onclick={onDismiss} title="Dismiss">Dismiss</button>
  </div>
</div>

<style>
  .agent-response {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    border-left: 3px solid #ccc;
    font-size: 12px;
  }

  .agent-response.bash { border-left-color: #58a6ff; }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tool-tag {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .tool-tag.bash {
    background: rgba(88, 166, 255, 0.15);
    color: #58a6ff;
  }

  .tool-tag.text {
    background: rgba(204, 204, 204, 0.15);
    color: #ccc;
  }

  .session-name {
    font-size: 10px;
    color: var(--text-secondary);
  }

  .collapse-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
  }

  .body {
    margin-bottom: 6px;
  }

  .command-block {
    display: block;
    background: var(--bg-primary);
    padding: 6px 8px;
    border-radius: 4px;
    font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 11px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .explanation {
    color: var(--text-secondary);
    font-size: 11px;
    margin-top: 4px;
    line-height: 1.4;
  }

  .text-content {
    color: var(--text-secondary);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
  }

  .actions {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.12s ease;
    border: 1px solid;
  }

  .action-btn.run {
    background: rgba(88, 166, 255, 0.08);
    color: #58a6ff;
    border-color: rgba(88, 166, 255, 0.3);
  }

  .action-btn.run:hover {
    background: rgba(88, 166, 255, 0.15);
    border-color: #58a6ff;
  }

  .action-btn.copy {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border-color: var(--border);
  }

  .action-btn.copy:hover {
    color: var(--text-primary);
    border-color: var(--text-secondary);
  }

  .action-btn.dismiss {
    background: none;
    color: var(--text-secondary);
    border-color: transparent;
    margin-left: auto;
  }

  .action-btn.dismiss:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }
</style>
