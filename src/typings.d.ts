declare namespace API {
  type CurrentUser = {
    uid?: string;
    username: string;
    role?: string;
    id?: number;
  };

  type LoginParams = {
    username: string;
    password: string;
  };

  type LoginResult = {
    token: string;
    user: CurrentUser;
    error?: string;
  };

  type Conversation = {
    id: string;
    title: string;
    system_prompt?: string;
    created_at?: string;
  };

  type Message = {
    id?: number;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
  };

  type Endpoint = {
    id: number;
    name: string;
    base_url: string;
    api_key?: string;
    api_key_preview?: string;
    is_default: boolean;
    use_preset_models: boolean;
    created_at?: string;
    updated_at?: string;
  };

  type Model = {
    id?: number;
    model_id: string;
    display_name: string;
  };

  type McpServer = {
    id: number;
    name: string;
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    is_enabled: number;
    created_at?: string;
  };
}
