import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listMcpServers } from "./database.js";

// Global map to hold connected MCP clients
// key: string (e.g. `uid_serverId`), value: { client: Client, transport: Transport }
const mcpClients = new Map();
// Track in-progress connect attempts to prevent races
const mcpConnecting = new Map();

/**
 * Ensures an MCP server is connected and returns the client instance.
 * @param {object} serverConfig - The MCP server configuration from database
 * @returns {Promise<Client>}
 */
export async function getConnectedMcpClient(serverConfig) {
    const clientKey = `${serverConfig.uid}_${serverConfig.id}`;

    if (mcpClients.has(clientKey)) {
        return mcpClients.get(clientKey).client;
    }

    // Deduplicate concurrent connect attempts
    if (mcpConnecting.has(clientKey)) {
        return mcpConnecting.get(clientKey);
    }

    // Initialize new connection
    const connectPromise = (async () => {
        const client = new Client(
            {
                name: `timo-client-${serverConfig.name}`,
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );

        let transport;

        try {
            if (serverConfig.type === "stdio") {
                let args = [];
                if (serverConfig.args) {
                    args = typeof serverConfig.args === 'string'
                        ? JSON.parse(serverConfig.args)
                        : serverConfig.args;
                }
                transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: args,
                });
            } else if (serverConfig.type === "sse") {
                transport = new SSEClientTransport(new URL(serverConfig.url));
            } else {
                throw new Error(`Unsupported MCP transport type: ${serverConfig.type}`);
            }

            // Register the close handler BEFORE connecting, so we don't miss early disconnects
            transport.onclose = () => {
                console.log(`[MCP] Connection lost for ${serverConfig.name}`);
                mcpClients.delete(clientKey);
            };

            await client.connect(transport);
            mcpClients.set(clientKey, { client, transport });

            return client;
        } catch (error) {
            console.error(`[MCP] Failed to connect to ${serverConfig.name}:`, error);
            if (transport) {
                transport.close().catch(console.error);
            }
            throw error;
        } finally {
            mcpConnecting.delete(clientKey);
        }
    })();

    mcpConnecting.set(clientKey, connectPromise);
    return connectPromise;
}

/**
 * Fetch available tools from all enabled MCP servers for a given user.
 * It connects to any configured MCP server if not already connected.
 * 
 * Returns an array of tools formatted according to OpenAI's tool schema:
 * {
 *   type: "function",
 *   function: { name: "", description: "", parameters: {...} }
 * }
 */
export async function getAllAvailableTools(uid) {
    const servers = listMcpServers(uid);
    const enabledServers = servers.filter(s => s.is_enabled === 1);
    const tools = [];

    for (const serverConfig of enabledServers) {
        try {
            const client = await getConnectedMcpClient(serverConfig);
            const mcpToolsRes = await client.listTools();

            for (const t of mcpToolsRes.tools) {
                // Ensure the tool name avoids collisions or prefix it with the server ID if needed
                // For simplicity, we assume name uniqueness or user manages it.
                // We inject the server ID as a custom property so we know where to route it later.
                tools.push({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description || "",
                        parameters: t.inputSchema || { type: "object", properties: {} },
                    },
                    _mcp_server_id: serverConfig.id // For internal routing
                });
            }
        } catch (e) {
            console.error(`[MCP] Skipping tools for ${serverConfig.name} due to error:`, e.message);
        }
    }

    return tools;
}

/**
 * Execute a specific tool on its associated MCP server.
 */
export async function executeMcpTool(uid, serverId, toolName, args) {
    const servers = listMcpServers(uid);
    const serverConfig = servers.find(s => s.id === serverId);

    if (!serverConfig) {
        throw new Error(`MCP Server ${serverId} not found or access denied.`);
    }

    const client = await getConnectedMcpClient(serverConfig);
    const result = await client.callTool({
        name: toolName,
        arguments: args,
    });

    return result;
}

/**
 * Force disconnects a specific server (e.g. when user changes settings)
 */
export async function disconnectMcpServer(uid, serverId) {
    const clientKey = `${uid}_${serverId}`;
    if (mcpClients.has(clientKey)) {
        const { transport } = mcpClients.get(clientKey);
        try {
            await transport.close();
        } catch (e) { /* ignore */ }
        mcpClients.delete(clientKey);
    }
}
