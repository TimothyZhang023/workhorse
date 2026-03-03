import request from 'supertest';

describe('auth + endpoints', () => {
  let app;
  let authToken;

  beforeAll(async () => {
    const { createApp } = await import('../server/app.js');
    app = createApp();
  });

  it('registers first user as admin and can access /me', async () => {
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ username: 'admin_user', password: 'password123' })
      .expect(200);

    expect(registerRes.body.user.username).toBe('admin_user');
    expect(registerRes.body.user.role).toBe('admin');
    expect(registerRes.body.token).toBeTruthy();

    authToken = registerRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(meRes.body.username).toBe('admin_user');
    expect(meRes.body.role).toBe('admin');
  });

  it('does not leak api_key in endpoint list and supports update without api_key', async () => {
    const createRes = await request(app)
      .post('/api/endpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'OpenAI',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test-secret-key',
        is_default: true,
        use_preset_models: true,
      })
      .expect(200);

    const endpointId = createRes.body.id;

    const listRes = await request(app)
      .get('/api/endpoints')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body[0].api_key).toBeUndefined();
    expect(listRes.body[0].api_key_preview).toMatch(/^sk-test-/);

    await request(app)
      .put(`/api/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'OpenAI Updated',
        base_url: 'https://api.openai.com/v1',
        use_preset_models: false,
      })
      .expect(200);

    const singleRes = await request(app)
      .get(`/api/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(singleRes.body.name).toBe('OpenAI Updated');
    expect(singleRes.body.api_key).toBe('sk-test-secret-key');
    expect(singleRes.body.use_preset_models).toBe(0);
  });
});
