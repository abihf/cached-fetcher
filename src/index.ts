
export type Loader<T> = () => Promise<T>;

export interface IOptions {
  defaultTtl: number;
  cleanInterval: number;
}

export interface IGetOptions {
  ttl?: number;
  doubleBuffer?: boolean;
}

interface IPromiseExecutor {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

interface ICacheItem {
  value: any;
  expire?: number;
  isFetching: boolean;
  queue: IPromiseExecutor[];
}

export interface IGetOptions {
  ttl?: number;
  doubleBuffer?: boolean;
}

const defaultOptions: IOptions = {
  cleanInterval: 0,
  defaultTtl: 60000, // 60 second
};

export default class CacheLoader {
  private items: { [name: string]: ICacheItem };
  private options: IOptions;
  private cleanIntervalHandler?: NodeJS.Timer = undefined;

  constructor(options: Partial<IOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
    this.items = {};
    if (this.options.cleanInterval > 0) {
      this.cleanIntervalHandler = setInterval(() => this.clean(), this.options.cleanInterval);
    }
  }

  public get<T>(name: string, loader: Loader<T>, options: IGetOptions = {}): Promise<T> {
    const cachedItem = this.items[name];
    if (cachedItem !== undefined) {
      if (cachedItem.isFetching) {
        return new Promise<T>((resolve, reject) => cachedItem.queue.push({ resolve, reject }));
      }
      if (
        options.doubleBuffer ||
        cachedItem.expire === undefined ||
        cachedItem.expire >= new Date().valueOf()
      ) {
        return Promise.resolve<T>(cachedItem.value);
      }
    }
    // else: item is not found or expired

    return new Promise<T>((resolve, reject) => {
      const newItem: ICacheItem = {
        isFetching: true,
        queue: [{ resolve, reject }],
        value: undefined,
      };
      if (cachedItem === undefined || !options.doubleBuffer) {
        this.items[name] = newItem;
      }

      loader()
      .then((value: T) => {
        newItem.value = value;
        newItem.isFetching = false;
        this.items[name] = newItem;

        const ttl: number = options.ttl !== undefined ? options.ttl : this.options.defaultTtl || 0;
        if (ttl > 0) {
          newItem.expire = new Date().valueOf() + ttl;
        }
        newItem.queue.forEach(({ resolve: resolveQueue }) => resolveQueue(value));
      })
      .catch((error) => {
        this.invalidate(name);
        newItem.queue.forEach(({ reject: rejectQueue }) => rejectQueue(error));
      });
    });
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

  public stopCacheCleaner() {
    if (this.cleanIntervalHandler) {
      clearInterval(this.cleanIntervalHandler);
      this.cleanIntervalHandler = undefined;
    }
  }
}
