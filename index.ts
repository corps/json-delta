export type AnyJson = boolean | number | string | null | JsonArray | JsonMap;
export interface JsonMap {
  [key: string]: AnyJson;
}
export interface JsonArray extends Array<AnyJson> {}

export type ObjPath = (string | number)[];
export type DiffInsert = [ObjPath, any];
export type DiffPart = DiffInsert | ObjPath;
export type Diff = DiffPart[];

export function isInsert(d: DiffPart): d is DiffInsert {
  return isArr(d[0]);
}

export function isObj(o: any): o is {[k: string]: any} {
  return o instanceof Object && !(o instanceof Array);
}

export function isArr(o: any): o is Array<any> {
  return o instanceof Array;
}

export function shallowCopy(o: AnyJson): AnyJson {
  if (isObj(o)) return {...o};
  if (isArr(o)) return o.slice();
  return o;
}

export function getContainer(
  orig: AnyJson,
  result: AnyJson,
  path: ObjPath
): AnyJson | void {
  let len = path.length;
  if (!len) return undefined;

  let origContainer: any = orig;
  let container: any = result;

  if (container === origContainer) container = shallowCopy(origContainer);

  for (let i = 0; i < len - 1; ++i) {
    let seg = path[i];

    if (typeof seg === "number" && isArr(origContainer) && isArr(container)) {
      origContainer = origContainer[seg];
      if (container[seg] === origContainer) {
        container = container[seg] = shallowCopy(origContainer);
      } else {
        container = container[seg];
      }
    }

    if (typeof seg === "string" && isObj(origContainer) && isObj(container)) {
      origContainer = origContainer[seg];
      if (container[seg] === origContainer) {
        container = container[seg] = shallowCopy(origContainer);
      } else {
        container = container[seg];
      }
    }
  }

  return container;
}

export function getVal(container: AnyJson, path: ObjPath): AnyJson {
  let len = path.length;

  for (let i = 0; i < len; ++i) {
    let seg = path[i];

    if (typeof seg === "number" && isArr(container)) {
      container = container[seg];
    }

    if (typeof seg === "string" && isObj(container)) {
      container = (container as any)[seg];
    }
  }

  return container;
}

export function applyDiff(o: AnyJson, d: Diff | void) {
  if (!d) return o;

  let result = shallowCopy(o);

  d.forEach(p => {
    if (isInsert(p)) result = applyInsert(o, result, p);
    else result = applyDelete(o, result, p);
  });

  return result;
}

export function applyInsert(
  orig: AnyJson,
  result: AnyJson,
  insert: DiffInsert
): AnyJson {
  let [path, val] = insert;
  let container: any = getContainer(orig, result, path);

  if (!container) return val;

  let key = path[path.length - 1];
  if (typeof key === "number" && isArr(container)) {
    container.splice(key, 0, val);
  }

  if (typeof key === "string" && isObj(container)) {
    container[key] = val;
  }

  return result;
}

export function applyDelete(
  orig: AnyJson,
  result: AnyJson,
  path: ObjPath
): AnyJson {
  let container: any = getContainer(orig, result, path);

  if (!container) return null;

  let key = path[path.length - 1];
  if (typeof key === "number" && isArr(container)) {
    container.splice(key, 1);
    return result;
  }

  if (typeof key === "string" && isObj(container)) {
    delete container[key];
    return result;
  }

  return null;
}

export function diff(
  a: AnyJson,
  b: AnyJson,
  tolerance = Infinity
): Diff | void {
  let result: Diff = [];
  if (gatherDiff(a, b, tolerance, [], result) || result.length > tolerance)
    return [[[], b]];
  if (result.length === 0) return null;
  return result;
}

function gatherDiff(
  a: AnyJson,
  b: AnyJson,
  tolerance = 3,
  path: ObjPath,
  result: Diff
): boolean {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  if (typeof a === "number" && isNaN(a)) a = null;
  if (typeof b === "number" && isNaN(b)) b = null;

  if (a === b) return false;

  if (typeof a !== typeof b) {
    result.push([path, b]);
    return false;
  }

  if (a instanceof Array) {
    if (!(b instanceof Array)) {
      result.push([path, b]);
      return false;
    }

    let offset = 0;

    const thunks: (() => void)[] = [];
    if (
      !arrDiff(
        a,
        b,
        tolerance - result.length,
        () => thunks.push(() => ++offset),
        (aIdx: number, bIdx: number) =>
          thunks.push(() => result.push(path.concat([offset]))),
        (aIdx: number, bIdx: number) =>
          thunks.push(() => {
            result.push([path.concat([offset++]), (b as any)[bIdx]]);
          })
      )
    )
      return true;

    for (let i = thunks.length - 1; i >= 0; --i) {
      thunks[i]();
    }

    return false;
  }

  if (b instanceof Array) {
    result.push([path, b]);
    return false;
  }

  if (a instanceof Object) {
    if (!(b instanceof Object)) {
      result.push([path, b]);
      return false;
    }

    for (var k in a as object) {
      if (!(k in (b as object))) {
        result.push(path.concat([k]));

        if (result.length > tolerance) {
          return true;
        }

        continue;
      }

      if (
        gatherDiff(
          (a as any)[k],
          (b as any)[k],
          tolerance,
          path.concat([k]),
          result
        )
      ) {
        return true;
      }

      if (result.length > tolerance) {
        return true;
      }
    }

    for (var k in b as any) {
      if (!(k in (a as any))) {
        result.push([path.concat([k]), (b as any)[k]]);

        if (result.length > tolerance) {
          return true;
        }
      }
    }

    return false;
  }

  result.push([path, b]);
  return false;
}

export function deepEqual(a: AnyJson, b: AnyJson) {
  return a === b || diff(a, b, 0) == null;
}

/**
 * Finds the longest common subsequence between a and b,
 * optionally shortcutting any search whose removed elements
 * would exceed the provided tolerance value.
 * If there is no match within the provided tolerance, this function
 * returns null.
 */
export function lcs(
  a: AnyJson[],
  b: AnyJson[],
  tolerance = a.length + b.length
): AnyJson[] | void {
  let result: AnyJson[] = [];
  return arrDiff(a, b, tolerance, aIdx => result.push(a[aIdx]))
    ? result.reverse()
    : null;
}

function arrDiff(
  a: AnyJson[],
  b: AnyJson[],
  tolerance = a.length + b.length,
  onEq: (aIdx: number, bIdx: number) => void,
  onPickA: (aIdx: number, bIdx: number) => void = () => null,
  onPickB: (aIdx: number, bIdx: number) => void = () => null
): boolean {
  tolerance = Math.min(tolerance, a.length + b.length);

  let aLen = a.length;
  let bLen = b.length;
  let aOfDiagonal = new Uint32Array(tolerance * 2 + 2);
  let aOfDiagonalForEditSize = new Array(tolerance + 1);

  let shortestEdit: [number, number] | void = (function() {
    for (var d = 0; d <= tolerance; ++d) {
      for (var k = -d; k <= d; k += 2) {
        let aIdx: number;

        let takeB = aOfDiagonal[k + 1 + tolerance];
        let takeA = aOfDiagonal[k - 1 + tolerance];
        if (k === -d || (k !== d && takeA < takeB)) {
          aIdx = takeB;
        } else {
          aIdx = takeA + 1;
        }

        let bIdx = aIdx - k;

        while (
          aIdx < aLen &&
          bIdx < bLen &&
          deepEqual(a[aIdx], b[bIdx])
        ) {
          aIdx++;
          bIdx++;
        }

        aOfDiagonal[k + tolerance] = aIdx;

        if (aIdx >= aLen && bIdx >= bLen) {
          aOfDiagonalForEditSize[d] = aOfDiagonal.slice();
          return [d, k] as [number, number];
        }
      }

      aOfDiagonalForEditSize[d] = aOfDiagonal.slice();
    }

    return null;
  })();

  if (shortestEdit) {
    let [d, k] = shortestEdit;
    let aIdx = aOfDiagonalForEditSize[d][k + tolerance];
    let bIdx = aIdx - k;

    while (d > 0) {
      let k = aIdx - bIdx;
      let v = aOfDiagonalForEditSize[d - 1];
      let prevK: number;
      if (k === -d || (k !== d && v[k - 1 + tolerance] < v[k + 1 + tolerance])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }

      let prevAIdx = v[prevK + tolerance];
      let prevBIdx = prevAIdx - prevK;

      while (aIdx > prevAIdx && bIdx > prevBIdx) {
        onEq(--aIdx, --bIdx);
      }

      if (aIdx > prevAIdx) {
        onPickA(--aIdx, bIdx);
      } else if (bIdx > prevBIdx) {
        onPickB(aIdx, --bIdx);
      }

      --d;
    }

    while (aIdx > 0 && bIdx > 0) {
      onEq(--aIdx, --bIdx);
    }

    return true;
  }

  return false;
}
