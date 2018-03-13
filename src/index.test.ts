import { CachedFetcher, Fetcher } from "./index";

const sleep = (duration, forwardTime = false) => forwardTime
  ? (jest.advanceTimersByTime(duration), Promise.resolve())
  : new Promise<void>((resolve) => setTimeout(resolve, duration));

describe("CacheLoader", () => {
  it("should resolve simple loader", () => {
    const random = Math.random();
    const fetcher: Fetcher<number> = jest.fn(async () => random);
    const cache = new CachedFetcher(fetcher);
    const result = cache.get("simple");

    expect(fetcher).toHaveBeenCalledTimes(1);
    return expect(result).resolves.toEqual(random);
  });

  it("should handle promise rejection", () => {
    const fetcher: Fetcher<number> = jest.fn(() => Promise.reject(new Error("error message")));
    const cache = new CachedFetcher(fetcher);
    const result = cache.get("error");

    expect(fetcher).toHaveBeenCalledTimes(1);
    return expect(result).rejects.toThrowError("error message");
  });

  it("should resolve delayed loader once", async () => {
    jest.useFakeTimers();

    const fetcher = jest.fn(async () => {
      await sleep(100);
      resolved = true;
      return "x";
    });
    const cache = new CachedFetcher<string>(fetcher);
    let resolved = false;

    const results: number[] = [];
    const order: number[] = [];

    // first run, loader will be called, but haven't resolved yet.
    const promise1 = cache.get("delayed")
      .then(() => results[0] = new Date().valueOf())
      .then(() => order.push(1));
    expect(resolved).not.toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();

    // afeter 50s, loader still haven't resolved yet. and it will not be called again.
    await sleep(50, true);
    const promise2 = cache.get("delayed")
      .then(() => results[1] = new Date().valueOf())
      .then(() => order.push(2));
    expect(resolved).not.toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(0);
    fetcher.mockClear();

    // the loader should be resolved by now
    await sleep(50, true);
    await promise1; // wait until promise chain executed
    expect(resolved).toBeTruthy();

    // even second call is 50ms after first one, both of them resolved in the same time
    expect(order).toEqual([1, 2]);
    expect(results[0]).toBeLessThanOrEqual(results[1]);
    expect(results[1] - results[0]).toBeLessThanOrEqual(5);

    // you can still get the cache after loader resolved.
    // and like you expect, it will not call the loader again.
    await cache.get("delayed");
    expect(fetcher).toHaveBeenCalledTimes(0);
  });

  it("should still run loader once when rejected", async () => {
    jest.useFakeTimers();

    let i = 0;
    const fetcher = jest.fn(
      (key, param, cache) => new Promise((_, reject) => setTimeout(() => {
        reject(new Error("y"))
      }, 100))
    );
    const cache = new CachedFetcher(fetcher);

    const order = [];
    const promise1 = cache.get("delayed").catch(() => order.push(1));
    await sleep(50, true);

    const promise2 = cache.get("delayed").catch(() => order.push(2));
    await sleep(50, true);
    await Promise.all([promise1, promise2]);

    const promise3 = cache.get("delayed").catch(() => order.push(3));
    await sleep(100, true);
    await Promise.all([promise3]);

    expect(order).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(2);

    jest.clearAllTimers();
  });
});
