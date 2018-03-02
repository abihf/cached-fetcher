import CacheLoader from "./index";

const sleep = (duration) => new Promise<void>((resolve) => setTimeout(resolve, duration));

describe("CacheLoader", () => {
  it("should resolve simple loader", () => {
    const cache = new CacheLoader();
    const random = Math.random();
    const loader = jest.fn(async () => random);
    const result = cache.get("simple", loader);

    expect(loader).toHaveBeenCalledTimes(2);
    return expect(result).resolves.toEqual(random);
  });

  it("should handle promise rejection", () => {
    const cache = new CacheLoader();
    const loader = jest.fn(async () => { throw new Error("error message")});
    const result = cache.get("error", loader);

    expect(loader).toHaveBeenCalledTimes(1);
    return expect(result).rejects.toThrowError("error message");
  });

  it("should resolve delayed loader once", async () => {
    // jest.useFakeTimers();

    const cache = new CacheLoader();
    let resolved = false;
    const loader = jest.fn(async () => {
      await sleep(100);
      resolved = true;
      return "x";
    });
    const results = [];
    const order = [];

    // first run, loader will be called, but haven't resolved yet.
    const promise1 = cache.get("delayed", loader)
      .then(() => results[0] = new Date().valueOf())
      .then(() => order.push(1));
    expect(resolved).not.toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(1);
    loader.mockClear();

    // afeter 50s, loader still haven't resolved yet. and it will not be called again.
    await sleep(50);
    const promise2 = cache.get("delayed", loader)
      .then(() => results[1] = new Date().valueOf())
      .then(() => order.push(2));
    expect(resolved).not.toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(0);
    loader.mockClear();

    // the loader should be resolved by now
    await sleep(50);
    expect(resolved).toBeTruthy();

    // even second call is 50ms after first one, both of them resolved in the same time
    expect(order).toEqual([1, 2]);
    expect(results[0]).toBeLessThanOrEqual(results[1]);
    expect(results[1] - results[0]).toBeLessThanOrEqual(5);

    // you can still get the cache after loader resolved.
    // and like you expect, it will not call the loader again.
    await cache.get("delayed", loader);
    expect(loader).toHaveBeenCalledTimes(0);
  });

  it("should still run loader once when rejected", async() => {
    const cache = new CacheLoader();
    const loader = jest.fn(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("y")), 100))
    );

    const result1 = cache.get("delayed", loader).catch(() => {});
    await sleep(50);
    const result2 = cache.get("delayed", loader).catch(() => {});
    await sleep(60);
    const result3 = cache.get("delayed", loader).catch(() => {});

    expect(loader).toHaveBeenCalledTimes(2);
    // return expect(results).resolves.toEqual(["x", "x", "x"]);
  });
});
