import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

describe("endpoint config import/export routes", () => {
  let app;
  let authToken;

  beforeAll(async () => {
    const { createApp } = await import("../server/app.js");
    app = createApp();
    authToken = "local-mode-token";
  });

  it("exports model configuration without secrets and imports it back", async () => {
    const unique = Date.now();
    const endpointName = `Export Endpoint ${unique}`;
    const endpointRes = await request(app)
      .post("/api/endpoints")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: endpointName,
        provider: "openai_compatible",
        base_url: `https://example-${unique}.com/v1`,
        api_key: "sk-secret-123",
        use_preset_models: false,
      })
      .expect(200);

    await request(app)
      .post(`/api/endpoints/${endpointRes.body.id}/models`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        model_id: `gpt-test-${unique}`,
        display_name: "Test Export Model",
        is_enabled: 1,
        generation_config: {
          context_window: 65536,
          temperature: 0.2,
        },
      })
      .expect(200);

    await request(app)
      .put("/api/endpoints/settings/model-policy")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        primary_model: `gpt-test-${unique}`,
        fallback_models: [`fallback-${unique}`],
      })
      .expect(200);

    const exportRes = await request(app)
      .get("/api/endpoints/export-config")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(exportRes.body.version).toBe(1);
    expect(exportRes.body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: endpointName,
          models: expect.arrayContaining([
            expect.objectContaining({
              model_id: `gpt-test-${unique}`,
              display_name: "Test Export Model",
            }),
          ]),
        }),
      ])
    );
    expect(JSON.stringify(exportRes.body)).not.toContain("sk-secret-123");

    const importRes = await request(app)
      .post("/api/endpoints/import-config")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        version: 1,
        exported_at: new Date().toISOString(),
        global_model_policy: {
          primary_model: `import-primary-${unique}`,
          fallback_models: [`import-fallback-${unique}`],
        },
        endpoints: [
          {
            name: `Imported Endpoint ${unique}`,
            provider: "openai_compatible",
            base_url: `https://imported-${unique}.example.com/v1`,
            is_default: 0,
            use_preset_models: 0,
            models: [
              {
                model_id: `import-model-${unique}`,
                display_name: "Imported Model",
                is_enabled: 1,
                generation_config: {
                  context_window: 32768,
                },
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(importRes.body.success).toBe(true);
    expect(importRes.body.global_model_policy.primary_model).toBe(
      `import-primary-${unique}`
    );
    const importedId = importRes.body.imported?.[0]?.endpoint_id;
    expect(importedId).toBeTruthy();

    const endpointsRes = await request(app)
      .get("/api/endpoints")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    const importedEndpoint = endpointsRes.body.find(
      (item) => item.name === `Imported Endpoint ${unique}`
    );
    expect(importedEndpoint).toBeTruthy();
    expect(importedEndpoint.api_key_preview).toBe("");

    const modelsRes = await request(app)
      .get(`/api/endpoints/${importedId}/models`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(modelsRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model_id: `import-model-${unique}`,
          display_name: "Imported Model",
        }),
      ])
    );
  });
});
