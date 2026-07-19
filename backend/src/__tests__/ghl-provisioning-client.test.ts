import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface MockHttp {
  request: ReturnType<typeof vi.fn>;
}
const mockHttp: MockHttp = { request: vi.fn() };
const axiosCreate = vi.fn((..._args: unknown[]) => mockHttp);

vi.mock('axios', () => ({
  default: { create: (...args: unknown[]) => axiosCreate(...args) },
  isAxiosError: (err: unknown) => Boolean((err as { isAxiosError?: boolean })?.isAxiosError),
}));

const { GhlProvisioningClient, GhlApiError, GhlAuthError } = await import(
  '../crm/ghl-provisioning-client.js'
);

let locationCounter = 0;
/** Fresh locationId per client so the shared per-location limiter never carries slots across tests. */
function makeClient() {
  return new GhlProvisioningClient({ accessToken: 'token-1', locationId: `loc_${++locationCounter}` });
}

function axiosError(status: number, headers: Record<string, string> = {}, data: unknown = {}) {
  return { isAxiosError: true, message: `Request failed with status ${status}`, response: { status, headers, data } };
}

beforeEach(() => {
  mockHttp.request.mockReset();
  axiosCreate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GhlProvisioningClient', () => {
  it('configures axios with the v2 base URL, bearer token and Version header', () => {
    makeClient();
    expect(axiosCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://services.leadconnectorhq.com',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-1',
          Version: '2021-07-28',
        }),
      })
    );
  });

  it('lists pipelines scoped to the location', async () => {
    const client = makeClient();
    mockHttp.request.mockResolvedValue({
      data: { pipelines: [{ id: 'p1', name: 'Sales', stages: [{ id: 's1', name: 'New' }] }] },
    });
    const pipelines = await client.listPipelines();
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/opportunities/pipelines',
        params: expect.objectContaining({ locationId: expect.stringMatching(/^loc_/) }),
      })
    );
    expect(pipelines).toEqual([{ id: 'p1', name: 'Sales', stages: [{ id: 's1', name: 'New', position: undefined }] }]);
  });

  it('sends full-replacement stage arrays on pipeline update', async () => {
    const client = makeClient();
    mockHttp.request.mockResolvedValue({ data: {} });
    await client.updatePipelineStages('p1', 'Sales', [
      { id: 's1', name: 'New', position: 0 },
      { name: 'Contacted', position: 1 },
    ]);
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        url: '/opportunities/pipelines/p1',
        data: expect.objectContaining({
          name: 'Sales',
          stages: [
            { id: 's1', name: 'New', position: 0 },
            { name: 'Contacted', position: 1 },
          ],
        }),
      })
    );
  });

  it('maps SINGLE_OPTIONS options to picklistOptions on field create', async () => {
    const client = makeClient();
    mockHttp.request.mockResolvedValue({ data: { customField: { id: 'f1', name: 'Interest', dataType: 'SINGLE_OPTIONS' } } });
    await client.createCustomField({ name: 'Interest', dataType: 'SINGLE_OPTIONS', options: ['Hot', 'Cold'] });
    expect(mockHttp.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        data: expect.objectContaining({ dataType: 'SINGLE_OPTIONS', model: 'contact', picklistOptions: ['Hot', 'Cold'] }),
      })
    );
  });

  it('throws GhlAuthError on 401 without retrying', async () => {
    const client = makeClient();
    mockHttp.request.mockRejectedValue(axiosError(401));
    await expect(client.listTags()).rejects.toBeInstanceOf(GhlAuthError);
    expect(mockHttp.request).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on 429 and retries in place', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    mockHttp.request
      .mockRejectedValueOnce(axiosError(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce({ data: { tags: [{ id: 't1', name: 'vip' }] } });

    const promise = client.listTags();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual([{ id: 't1', name: 'vip' }]);
    expect(mockHttp.request).toHaveBeenCalledTimes(2);
  });

  it('gives up on persistent 429 with a GhlApiError', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    mockHttp.request.mockRejectedValue(axiosError(429, { 'retry-after': '1' }));

    const promise = client.listTags();
    const assertion = expect(promise).rejects.toMatchObject({ name: 'GhlApiError', status: 429 });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(mockHttp.request).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('wraps other HTTP failures in GhlApiError with status and body', async () => {
    const client = makeClient();
    mockHttp.request.mockRejectedValue(axiosError(422, {}, { message: 'bad field' }));
    await expect(client.createTag('x')).rejects.toMatchObject({
      name: 'GhlApiError',
      status: 422,
      body: { message: 'bad field' },
    });
    expect(GhlApiError).toBeDefined();
  });

  it('spaces consecutive requests by the limiter interval', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    mockHttp.request.mockResolvedValue({ data: { tags: [] } });

    await client.listTags(); // first call takes the immediate slot
    let secondDone = false;
    const second = client.listTags().then(() => { secondDone = true; });

    await vi.advanceTimersByTimeAsync(100);
    expect(secondDone).toBe(false); // still inside the 200ms spacing window
    await vi.advanceTimersByTimeAsync(150);
    await second;
    expect(secondDone).toBe(true);
  });

  it('fails loudly when contact upsert returns no id', async () => {
    const client = makeClient();
    mockHttp.request.mockResolvedValue({ data: {} });
    await expect(
      client.upsertContact(
        { firstName: 'J', lastName: 'D', email: 'j@x.example.com', phone: '+15550100001' },
        []
      )
    ).rejects.toMatchObject({ name: 'GhlApiError' });
  });
});
