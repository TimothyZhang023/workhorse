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
    channel_id?: number | null;
    context_window?: number | null;
    tool_names?: string[] | null;
    created_at?: string;
  };

  type Channel = {
    id: number;
    name: string;
    platform: string;
    webhook_url?: string | null;
    bot_token?: string | null;
    metadata?: Record<string, any> | null;
    is_enabled: number;
    listener_state?: {
      active: boolean;
      platform: string;
      channelId: number;
      status: string;
      lastError?: string;
      updatedAt?: string;
    } | null;
    created_at?: string;
    updated_at?: string;
  };

  type ChannelExtension = {
    platform: string;
    name: string;
    metadata?: Record<string, any>;
  };

  type GlobalSystemPromptSetting = {
    key: string;
    markdown: string;
  };

  type Message = {
    id?: number;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
  };

  type McpTool = {
    type: "function";
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, any>;
    };
  };

  type Endpoint = {
    id: number;
    name: string;
    provider?: "openai_compatible" | "openai" | "gemini" | "openrouter";
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
    is_enabled?: number;
    source?: "remote" | "manual";
    endpoint_id?: number;
    endpoint_name?: string;
    endpoint_provider?: string;
    generation_config?: {
      temperature?: number;
      top_p?: number;
      max_tokens?: number;
      presence_penalty?: number;
      frequency_penalty?: number;
      context_window?: number;
      [key: string]: number | undefined;
    };
  };

  type GlobalModelPolicy = {
    primary_model: string;
    fallback_models: string[];
  };

  type McpServer = {
    id: number;
    name: string;
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    auth?: {
      type: "bearer" | "basic";
      token?: string;
      username?: string;
      password?: string;
    };
    is_enabled: number;
    created_at?: string;
  };

  type McpGenerationRequest = {
    requirement: string;
    auto_create?: boolean;
  };

  type McpGenerationResult = {
    draft: Partial<McpServer>;
    server?: McpServer;
    model?: string;
    endpoint?: string;
  };

  type MarketMcpServer = {
    name: string;
    title?: string;
    description?: string;
    version?: string;
    repository_url?: string;
    website_url?: string;
    transport?: string;
    remote_url?: string;
    package_identifier?: string;
    package_registry?: string;
    package_transport?: string;
    requires_headers?: boolean;
    remote_headers?: Array<Record<string, any>>;
  };

  type McpTestResult = {
    success: boolean;
    server_id: number;
    server_name: string;
    tool_count: number;
    tool_names: string[];
  };

  type DefaultMcpTemplate = {
    id: string;
    name: string;
    description: string;
    category: string;
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    auth?: McpServer["auth"] | null;
    is_enabled: number;
    needs_configuration?: boolean;
    keywords?: string[];
    source_url?: string;
  };

  type Skill = {
    id: number;
    name: string;
    description?: string;
    prompt: string;
    examples?: any[];
    tools?: string[];
    is_enabled?: number;
    source_type?: "git" | "zip" | null;
    source_location?: string | null;
    source_item_path?: string | null;
    source_refreshed_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };

  type SkillInstallResult = {
    source_type: "git" | "zip";
    source_location: string;
    updated: boolean;
    installed_count: number;
    installed: Skill[];
  };

  type SkillGenerationRequest = {
    requirement: string;
    auto_create?: boolean;
  };

  type SkillGenerationResult = {
    draft: Partial<Skill>;
    skill?: Skill;
    model?: string;
    endpoint?: string;
  };

  type AgentTask = {
    id: number;
    name: string;
    description?: string;
    system_prompt: string;
    skill_ids: number[];
    tool_names: string[];
    is_active: number;
    created_at?: string;
    updated_at?: string;
  };

  type AgentTaskGenerationRequest = {
    requirement: string;
    auto_create?: boolean;
  };

  type AgentTaskGenerationAnalysis = {
    summary: string;
    workflow_steps: string[];
    capability_breakdown: string[];
    search_queries: string[];
    existing_skill_ids?: number[];
  };

  type AgentTaskGenerationMarketMcp = {
    name: string;
    title?: string;
    transport?: string;
    reason: string;
    repository_url?: string;
    remote_url?: string;
    template_id?: string;
  };

  type AgentTaskGenerationResult = {
    analysis: AgentTaskGenerationAnalysis;
    draft: Partial<AgentTask>;
    suggested_skills: Partial<Skill>[];
    recommended_mcp_templates: DefaultMcpTemplate[];
    market_mcp_recommendations: AgentTaskGenerationMarketMcp[];
    created_skills?: Skill[];
    task?: AgentTask;
    model?: string;
    endpoint?: string;
  };

  type TaskRun = {
    id: number;
    uid?: string;
    task_id: number;
    task_name?: string;
    cron_job_id?: number | null;
    cron_job_name?: string | null;
    conversation_id?: string | number | null;
    conversation_title?: string | null;
    trigger_source: "manual" | "cron";
    status: "running" | "success" | "failed";
    initial_message?: string;
    final_response?: string;
    error_message?: string;
    started_at?: string;
    finished_at?: string;
    created_at?: string;
  };

  type TaskRunEvent = {
    id: number;
    run_id: number;
    uid?: string;
    event_type: string;
    title: string;
    content?: string;
    metadata?: Record<string, any> | null;
    created_at?: string;
  };

  type TaskRunStartResult = {
    runId: number;
    conversationId: string;
    status: "running";
  };

  type CronJob = {
    id: number;
    task_id: number;
    name: string;
    cron_expression: string;
    next_run?: string;
    last_run?: string;
    last_status?: string;
    is_enabled: number;
  };
}
