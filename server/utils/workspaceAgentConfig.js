import {
  getAcpAgent,
  getAppSetting,
  getChannelById,
} from "../models/database.js";

export const MAIN_AGENT_PROMPT_SETTING_KEY = "main_agent_prompt";

export function getMainAgentPrompt(uid) {
  return String(getAppSetting(uid, MAIN_AGENT_PROMPT_SETTING_KEY, "") || "").trim();
}

export function getConversationAgentPrompt(uid, conversation) {
  if (!conversation) {
    return "";
  }

  if (conversation.acp_agent_id) {
    return String(
      getAcpAgent(conversation.acp_agent_id, uid)?.agent_prompt || ""
    ).trim();
  }

  if (conversation.channel_id) {
    return String(getChannelById(conversation.channel_id, uid)?.agent_prompt || "").trim();
  }

  return getMainAgentPrompt(uid);
}
