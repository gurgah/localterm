/**
 * Permission Handler Service
 * Handles sending responses to Claude Code permission prompts
 */

import { writeToSession } from "../utils/tauri";
import { orchestratorQueue } from "../stores/orchestrator";
import { sessions } from "../stores/sessions";

/**
 * Send a response to a permission prompt
 * @param sessionId - The terminal session ID
 * @param optionIndex - 0-based index of the selected option
 */
export async function sendPermissionResponse(
  sessionId: string,
  optionIndex: number
): Promise<void> {
  // Claude uses 1-based option numbers
  const optionNumber = String(optionIndex + 1);

  try {
    await writeToSession(sessionId, optionNumber);
    sessions.setStatus(sessionId, "active");
  } catch (error) {
    console.error("Failed to send permission response:", error);
  }
}
