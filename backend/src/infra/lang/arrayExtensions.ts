type Predicate<T> = (value: T, index: number, array: T[]) => boolean;
type TypeGuardPredicate<T, S extends T> = (value: T, index: number, array: T[]) => value is S;

declare global {
  interface Array<T> {
    single(this: T[]): T;
    single<S extends T>(this: T[], predicate: TypeGuardPredicate<T, S>): S;
    single(this: T[], predicate: Predicate<T>): T;
    singleOrDefault(this: T[]): T | undefined;
    singleOrDefault<S extends T>(this: T[], predicate: TypeGuardPredicate<T, S>): S | undefined;
    singleOrDefault(this: T[], predicate: Predicate<T>): T | undefined;
  }
}

const SINGLE_NO_ELEMENTS = "Expected a single element but sequence contains no elements.";
const SINGLE_MULTIPLE_ELEMENTS = "Expected a single element but sequence contains multiple elements.";

function resolveCandidates<T>(source: T[], predicate?: Predicate<T>): T[] {
  return predicate ? source.filter(predicate) : source;
}

function singleImpl<T>(source: T[], predicate?: Predicate<T>): T {
  const candidates = resolveCandidates(source, predicate);
  if (candidates.length === 1) return candidates[0] as T;
  if (candidates.length === 0) {
    throw new Error(SINGLE_NO_ELEMENTS);
  }
  throw new Error(SINGLE_MULTIPLE_ELEMENTS);
}

function singleOrDefaultImpl<T>(source: T[], predicate?: Predicate<T>): T | undefined {
  const candidates = resolveCandidates(source, predicate);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0] as T;
  throw new Error(SINGLE_MULTIPLE_ELEMENTS);
}

if (!Object.prototype.hasOwnProperty.call(Array.prototype, "single")) {
  Object.defineProperty(Array.prototype, "single", {
    value: function <T>(this: T[], predicate?: Predicate<T>): T {
      return singleImpl(this, predicate);
    },
    writable: false,
    configurable: false,
  });
}

if (!Object.prototype.hasOwnProperty.call(Array.prototype, "singleOrDefault")) {
  Object.defineProperty(Array.prototype, "singleOrDefault", {
    value: function <T>(this: T[], predicate?: Predicate<T>): T | undefined {
      return singleOrDefaultImpl(this, predicate);
    },
    writable: false,
    configurable: false,
  });
}

export {};
