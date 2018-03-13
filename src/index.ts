/**
 * Fetcher function
 *
 * @export
 * @callback Fetcher
 * @param {string} key
 * @param {object} params
 * @param {CachedFetcher} instance
 * @returns {Promise<T>}
 * @template T data type
 */
export type Fetcher<T> = (key: string, params: any, instance: CachedFetcher<T>) => Promise<T>;

/**
 * Configuration for CachedFetcher constructor
 *
 * @export
 * @interface IConfig
 * @template T data type
 */
export interface IConfig<T> {
  /**
   * Default fetcher function
   *
   * @type {Fetcher}
   * @memberof IConfig
   */
  fetcher: Fetcher<T>;

  /**
   * Cache duration before it marked as stale
   *
   * @type {number}
   * @memberof IConfig
   */
  ttl: number;

  /**
   * in miliseconds. 0 to disable automatic clean old cache
   *
   * @type {number}
   * @memberof IConfig
   */
  cleanInterval: number;

  /**
   * Cache the fetcher result even it thrown an error
   *
   * @type {boolean}
   * @memberof IConfig
   */
  cacheError: boolean;

  /**
   * Enable experimental double buffering feature.
   * This will allow CacheLoader to return stale value and fetch new value in background.
   *
   * @type {boolean}
   * @memberof IConfig
   */
  doubleBuffer: boolean;
}

/**
 * Option for CachedFetcher.fetch()
 *
 * @export
 * @interface IFetchOptions
 * @template T Data type
 */
export interface IFetchOptions<T> {
  /**
   * Parameter to pass to the fetcher
   *
   * @type {*}
   * @memberof IFetchOptions
   */
  params?: any;

  /**
   * Override default fetcher for this call
   */
  ttl?: number;

  /**
   * Enable double buffering for this item.
   *
   * @type {boolean}
   * @memberof IFetchOptions
   */
  doubleBuffer?: boolean;

  /**
   * Override fetcher for this key
   *
   * @type {Fetcher<T>}
   * @memberof IFetchOptions
   */
  fetcher?: Fetcher<T>;
}

interface IPromiseExecutor {
  resolve: (result?: any) => void;
  reject: (error?: Error) => void;
}

interface ICacheItem<T> {
  value?: T;
  hasError: boolean;
  error?: Error;
  expire?: number;
  isFetching: boolean;
  queue: IPromiseExecutor[];
}

const defaultConfig: IConfig<any> = {
  cacheError: false,
  cleanInterval: 0,
  doubleBuffer: false,
  fetcher: () => Promise.reject(new Error('You must define the fetcher')),
  ttl: 60000, // 60 second
};

/**
 * Main Class
 *
 * @example
 * const cache = new CachedFetcher<Post>((id) => fetch({url: `https://example.com/posts/${id}`));
 * const data = await cache.fetch('123');
 *
 * @export
 * @class CachedFetcher
 * @template T Data type
 */
export class CachedFetcher<T> {
  private items: { [name: string]: ICacheItem<T> };
  private config: IConfig<T>;
  private cleanIntervalHandler?: NodeJS.Timer = undefined;

  /**
   * Creates an instance of CachedFetcher.
   * @param {(Partial<IConfig<T>> | Fetcher<T>)} config Optional config. See #IConfig
   * @param {Fetcher<T>} [fetcher] Fetcher
   * @memberof CachedFetcher
   */
  constructor(config: Partial<IConfig<T>> | Fetcher<T>, fetcher?: Fetcher<T>) {
    this.items = {};
    if (typeof config === 'function') {
      this.config = { ...defaultConfig, fetcher: config };
    } else {
      this.config = { ...defaultConfig, ...config };
      if (fetcher !== undefined) {
        this.config.fetcher = fetcher;
      }
    }

    this.startCacheCleaner();
  }

  /**
   * Get cached item
   *
   * @async
   * @param {string} key item's name
   * @param {IFetchOptions<T>} [options={}] custom fetch options
   * @returns {Promise<T>} promise that resolve actual item
   * @memberof CachedFetcher
   */
  public get(key: string, options: IFetchOptions<T> = {}): Promise<T> {
    const cachedItem = this.items[key];
    const doubleBuffer = options.doubleBuffer || this.config.doubleBuffer;
    if (cachedItem !== undefined) {
      if (cachedItem.isFetching) {
        return new Promise<T>((resolve, reject) => cachedItem.queue.push({ resolve, reject }));
      }
      if (
        doubleBuffer ||
        cachedItem.expire === undefined ||
        cachedItem.expire >= new Date().valueOf()
      ) {
        if (cachedItem.hasError) {
          return Promise.reject(cachedItem.error);
        }
        return Promise.resolve<T>(cachedItem.value as T);
      }
    }

    const newItem: ICacheItem<T> = {
      hasError: false,
      isFetching: true,
      queue: [],
      value: undefined,
    };
    if (cachedItem === undefined || !options.doubleBuffer) {
      this.items[key] = newItem;
    }
    const resultPromise = new Promise<T>(
      (resolve, reject) => newItem.queue.push({ resolve, reject }),
    );

    const fetcher: Fetcher<T> = options.fetcher || this.config.fetcher;
    fetcher(key, options.params, this)
      .then((value: T) => {
        newItem.value = value;
      })
      .catch((error: Error) => {
        newItem.hasError = true;
        newItem.error = error;
      }).then(() => {
        if (newItem.hasError) {
          newItem.queue.forEach(({ reject }) => reject(newItem.error));
        } else {
          newItem.queue.forEach(({ resolve }) => resolve(newItem.value));
        }
        if (!newItem.hasError || this.config.cacheError) {
          const ttl: number = options.ttl !== undefined
            ? options.ttl
            : this.config.ttl || 0;
          if (ttl > 0) {
            newItem.expire = new Date().valueOf() + ttl;
          }
          this.items[key] = newItem;
        } else {
          this.invalidate(key);
        }
        newItem.isFetching = false;
      });

    return resultPromise;
  }

  public clean() {
    const now = new Date().valueOf();
    Object.keys(this.items).forEach((name) => {
      const item = this.items[name];
      if (item.expire !== undefined && item.expire < now) {
        this.invalidate(name);
      }
    });
  }

  public invalidate(name: string) {
    delete this.items[name];
  }

  public invalidateAll() {
    this.items = {};
  }

  public startCacheCleaner(interval?: number) {
    this.stopCacheCleaner();
    const realInterval = interval || this.config.cleanInterval;
    if (realInterval) {
      this.cleanIntervalHandler = setInterval(() => this.clean(), realInterval);
    }
  }

  public stopCacheCleaner() {
    if (this.cleanIntervalHandler) {
      clearInterval(this.cleanIntervalHandler);
      this.cleanIntervalHandler = undefined;
    }
  }
}

// also export default
export default CachedFetcher;
