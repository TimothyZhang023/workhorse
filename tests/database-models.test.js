import {
  createApiKey,
  createEndpointGroup,
  createUser,
  deleteEndpointGroup,
  createChannel,
  deleteChannel,
  getDefaultEndpointGroup,
  getEndpointGroups,
  listChannels,
  listApiKeys,
  revokeApiKey,
  updateChannel,
  updateEndpointGroup,
  verifyApiKey,
} from "../server/models/database.js";

describe("Database Models - Endpoint Groups", () => {
  it("creates, reads, updates and deletes endpoint groups correctly", () => {
    const user = createUser(`user_${Date.now()}`, "password123");

    const ep1 = createEndpointGroup(
      user.uid,
      "Group 1",
      "openai",
      "https://api.example.com",
      "key-123",
      true,
      true
    );
    expect(ep1.id).toBeGreaterThan(0);
    expect(ep1.name).toBe("Group 1");

    const groups = getEndpointGroups(user.uid);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Group 1");
    expect(groups[0].provider).toBe("openai");
    expect(groups[0].api_key).toBe("key-123"); // Assert decryption works

    updateEndpointGroup(
      ep1.id,
      user.uid,
      "Group 1 Updated",
      "openrouter",
      "https://api.updated.com",
      "key-456",
      false
    );

    let defaultGroup = getDefaultEndpointGroup(user.uid);
    expect(defaultGroup.name).toBe("Group 1 Updated");
    expect(defaultGroup.provider).toBe("openrouter");
    expect(defaultGroup.base_url).toBe("https://api.updated.com");
    expect(defaultGroup.api_key).toBe("key-456");
    expect(defaultGroup.use_preset_models).toBe(0);

    const ep2 = createEndpointGroup(
      user.uid,
      "Group 2",
      "gemini",
      "https://api2.example.com",
      "key-789",
      true,
      true
    );

    const allGroups = getEndpointGroups(user.uid);
    expect(allGroups).toHaveLength(2);

    defaultGroup = getDefaultEndpointGroup(user.uid);
    expect(defaultGroup.id).toBe(ep2.id);

    deleteEndpointGroup(ep1.id, user.uid);
    expect(getEndpointGroups(user.uid)).toHaveLength(1);
  });
});


describe("Database Models - Channels", () => {
  it("creates, updates and deletes channels", () => {
    const user = createUser(`user_${Date.now()}_channel`, "password123");

    const channel = createChannel(user.uid, {
      name: "Ops Telegram",
      platform: "telegram",
      bot_token: "bot-token",
      metadata: { room: "ops" },
      is_enabled: 1,
    });

    expect(channel.id).toBeGreaterThan(0);

    const channels = listChannels(user.uid);
    expect(channels).toHaveLength(1);
    expect(channels[0].metadata.room).toBe("ops");

    updateChannel(channel.id, user.uid, { is_enabled: 0, name: "Ops TG" });
    const updated = listChannels(user.uid)[0];
    expect(updated.name).toBe("Ops TG");
    expect(updated.is_enabled).toBe(0);

    deleteChannel(channel.id, user.uid);
    expect(listChannels(user.uid)).toHaveLength(0);
  });
});
