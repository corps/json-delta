import {
  deepEqual,
  shallowCopy,
  lcs,
  getVal,
  getContainer,
  Diff,
  AnyJson,
  ObjPath,
  applyDiff,
  diff,
  isArr,
  isObj,
} from "./index.js";

interface ArrGenOpts {
  length?: number | QcGen<number>;
  sparse?: boolean;
}

type QcGen<T> = (s: number) => T;

interface Qc {
  arrayOf<T>(gen: QcGen<T>, opts?: ArrGenOpts): QcGen<T[]>;
  array: {
    subsetOf<T>(arr: T[], opts?: ArrGenOpts): QcGen<T[]>;
  };
  bool: QcGen<boolean>;
  byte: QcGen<number>;
  fromFunction<T>(f: () => T, ...gens: QcGen<any>[]): QcGen<T>;
  ureal: QcGen<number>;
  real: QcGen<number>;
  uint: QcGen<number>;
  int: {
    between(min: number, max: number): QcGen<number>;
    (): number;
  };
  random: QcGen<number>;
  string: QcGen<string>;
  obj: QcGen<object>;
  objectOf(vGen: QcGen<any>, kGen?: QcGen<string>): QcGen<object>;
  any: {
    simple: QcGen<number | string | undefined | null | boolean>;
  };
  oneOf(...gens: QcGen<any>[]): QcGen<any>;
  map<A, B>(f: (a: A) => B, gen: QcGen<A>): QcGen<B>;
  join<T>(gen: QcGen<QcGen<T>>): QcGen<T>;
  pick<T>(...vals: T[]): QcGen<T>;
  except<T>(gen: QcGen<T>, ...vals: T[]): QcGen<T>;
  _performShrinks: boolean;
}

interface Assert {
  equal: (a: any, b: any, msg?: string) => void;
  deepEqual: (a: any, b: any, msg?: string) => void;
  strictEqual: (a: any, b: any, msg?: string) => void;
  ok: (a: any, msg?: string) => void;
  notOk: (a: any, msg?: string) => void;
  forAll: (f: (...args: any[]) => boolean, ...gens: QcGen<any>[]) => void;
}

declare var QUnit: any;
declare var qc: Qc;

qc._performShrinks = false;

const test: (desc: string, f: (assert: Assert) => void) => void = QUnit.test;

const nullLike = qc.pick(null, undefined);
const nonNullLike = qc.except(qc.any.simple, null, undefined);

const arr: QcGen<any[]> = qc.arrayOf(s =>
  qc.oneOf(qc.real, qc.string, qc.bool, nullLike, arr, obj)(s)
);

const obj: QcGen<any> = qc.objectOf(s =>
  qc.oneOf(qc.real, qc.string, qc.bool, nullLike, arr, obj)(s)
);

const anyJson = qc.oneOf(
  qc.real,
  qc.int,
  qc.string,
  qc.bool,
  nullLike,
  arr,
  obj
);

function shuffledArray<T>(a: T[]): T[] {
  let result = a.slice();
  for (var i = a.length - 1; i > 0; --i) {
    let j = Math.floor(Math.random() * (i + 1));
    let tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }

  return result;
}

function deepShuffledObjs(a: any): any {
  if (a == null) return a;

  if (typeof a === "object") {
    if (a instanceof Array) {
      return a.map(deepShuffledObjs);
    }

    let keys = shuffledArray(Object.keys(a));
    let result: any = {};
    keys.forEach(k => {
      result[k] = deepShuffledObjs(a[k]);
    });

    return result;
  }

  return a;
}

function naiveLcs(a: any[], b: any[]): any[] {
  if (a.length === 0) return [];
  if (b.length === 0) return [];

  if (a[0] === b[0]) {
    return [a[0]].concat(naiveLcs(a.slice(1), b.slice(1)));
  }

  let bestA = naiveLcs(a.slice(1), b);
  let bestB = naiveLcs(a, b.slice(1));

  return bestA.length >= bestB.length ? bestA : bestB;
}

const assert = QUnit.assert;
function checkLcs(a: any[], b: any[], tolerance?: number) {
  let naiveSeq = naiveLcs(a, b);
  let seq = lcs(a, b);

  if (!seq) {
    assert.ok(false, "seq was empty for " + a.join(" ") + ", " + b.join(" "));
    return false;
  }

  if (naiveSeq.length !== seq.length) {
    assert.deepEqual(seq, naiveSeq, a.join(" ") + ", " + b.join(" "));
    return false;
  }

  let idx = 0;
  if (seq.some(v => (idx = console.log(v, idx) || a.indexOf(v, idx) + 1) === 0)) {
    assert.deepEqual(seq, naiveSeq, a.join(" ") + ", " + b.join(" "));
    return false;
  }

  assert.ok(true, a.join(" ") + ", " + b.join(" "));
  return true;
}

function allObjPaths(o: any, curPath: ObjPath = [], result: ObjPath[] = []) {
  result.push(curPath);

  if (isObj(o)) {
    for (let k in o) {
      let nextPath = curPath.concat([k]);
      allObjPaths(o[k], nextPath, result);
    }
  } else if (isArr(o)) {
    for (let i = 0; i < o.length; ++i) {
      let nextPath = curPath.concat([i]);
      allObjPaths(o[i], nextPath, result);
    }
  }

  return result;
}

function exceptDeepEqualTo<T extends AnyJson>(
  gen: QcGen<T>,
  ...vs: T[]
): QcGen<T> {
  return s => {
    let value = gen(s);
    while (vs.some(v => deepEqual(v, value))) value = gen(s);
    return value;
  };
}

function mutationsOf(
  o: AnyJson,
  vGen = anyJson,
  mutationsCnt = qc.int.between(1, 10)
): QcGen<Diff> {
  return s => {
    let remainingMutations = mutationsCnt(s);
    let diff: Diff = [];
    let unchangedOfO = shallowCopy(o);
    let resultOfDiff = shallowCopy(o);

    let generated: AnyJson[] = [];
    let oldVGen = vGen;
    let allOriginalValues = allObjPaths(o).map(p => getVal(o, p));
    vGen = s => {
      let next = exceptDeepEqualTo(oldVGen, ...generated, ...allOriginalValues)(
        s
      );
      generated.push(next);
      return next;
    };

    while (
      ((isArr(unchangedOfO) && unchangedOfO.length) ||
        (isObj(unchangedOfO) && Object.keys(unchangedOfO).length)) &&
      remainingMutations > 0
    ) {
      let allUnChangedPaths = allObjPaths(unchangedOfO);
      let path: ObjPath = qc.pick(allUnChangedPaths)(s) as any;
      let container: any;
      if (path) container = getContainer(o, unchangedOfO, path);

      switch (qc.pick("d", "i", "r")(s)) {
        case "d":
          if (path.length > 0) {
            if (generated.indexOf(getVal(resultOfDiff, path)) === -1) {
              unchangedOfO = applyDiff(unchangedOfO, [path]);
              diff.push(path);
              remainingMutations--;
              resultOfDiff = applyDiff(resultOfDiff, [diff[diff.length - 1]]);
              continue;
            }
          }

        case "r":
          if (path.length > 0 && container && isObj(container)) {
            unchangedOfO = applyDiff(unchangedOfO, [path]);
            let newValue = exceptDeepEqualTo(vGen, getVal(o, path))(s);
            diff.push([path, newValue]);
            remainingMutations--;
            resultOfDiff = applyDiff(resultOfDiff, [diff[diff.length - 1]]);
            continue;
          }

        case "i":
          if (container) {
            let key: number | string;

            if (isObj(container)) {
              key = qc.except(qc.string, ...Object.keys(container))(s);
            }

            if (isArr(container)) {
              key = Math.floor(Math.random() * container.length);
            }

            path = path.slice();
            path.splice(path.length - 1, 1, key);

            diff.push([path, vGen(s)]);
            remainingMutations--;
            resultOfDiff = applyDiff(resultOfDiff, [diff[diff.length - 1]]);
            continue;
          }
      }
    }

    return diff;
  };
}

let arrWithSmallDomain = qc.arrayOf(qc.pick("a", "b", "c", "d", "e"), {
  length: qc.int.between(0, 12),
});

function withMutations(vGen: QcGen<AnyJson>): [QcGen<AnyJson>, QcGen<Diff>] {
  let lastObj: AnyJson;
  return [
    (s: number) => (lastObj = vGen(s)),
    (s: number) => mutationsOf(lastObj)(s),
  ];
}

test("lcs", assert => {
  checkLcs(
    ["d", "b", "b", "b", "c", "b", "d", "d", "b", "a"],
    ["b", "d", "d", "e", "a", "d", "a", "b", "c"]
  );
  checkLcs(["a", "b", "e", "c", "e"], ["c", "a", "a", "a", "e"]);
  checkLcs(["b", "d"], ["c", "a", "b"]);
  checkLcs([], []);
  checkLcs(["a", "b", "e", "e", "d"], ["a", "c", "a"]);
  checkLcs(
    ["d", "a", "a", "e", "b", "e"],
    ["a", "d", "c", "c", "a", "c", "d", "b", "c", "b", "c"]
  );
  checkLcs(["e", "c", "a", "b", "a", "d", "b", "d"], ["a", "e", "a"]);

  assert.forAll(checkLcs, arrWithSmallDomain, arrWithSmallDomain);

  assert.forAll(
    (a: any[], b: any[]) => {
      const seq = naiveLcs(a, b);
      return checkLcs(a, b, a.length + b.length - (seq.length * 2));
    },
    arrWithSmallDomain,
    arrWithSmallDomain
  );

  assert.forAll(
    (a: any[], b: any[]) => {
      const seq = naiveLcs(a, b);
      return !lcs(a, b, a.length + b.length - (seq.length * 2) - 1);
    },
    arrWithSmallDomain,
    arrWithSmallDomain
  );
});

test("deepEqual", assert => {
  assert.forAll((a, b) => deepEqual(a, b), nullLike, nullLike);
  assert.forAll(
    (a, b) => !deepEqual(a, b) && !deepEqual(b, a),
    nonNullLike,
    nullLike
  );

  assert.forAll(a => deepEqual(a, a), anyJson);
  assert.forAll(a => !deepEqual(a - 1, a), qc.real);
  assert.forAll(a => !deepEqual(a + "v", a), qc.string);
  assert.forAll(a => !deepEqual(!a, a), qc.bool);

  assert.forAll(a => deepEqual(a, deepShuffledObjs(a)), anyJson);
  assert.forAll(a => deepEqual(deepShuffledObjs(a), a), anyJson);

  assert.forAll((a: any, diff: Diff) => {
    if (diff.length === 0) return true;
    return !deepEqual(a, applyDiff(a, diff));
  }, ...withMutations(obj));

  assert.forAll((a: any[], diff: Diff) => {
    if (diff.length === 0) return true;
    return !deepEqual(a, applyDiff(a, diff));
  }, ...withMutations(arr));
});

test("diff", assert => {
  assert.forAll((a, b) => deepEqual(applyDiff(a, diff(a, b)), b), anyJson, anyJson);

  assert.forAll((a: any, d: Diff) => {
    let b = applyDiff(a, d);
    return deepEqual(applyDiff(a, diff(a, b)), b)
  }, ...withMutations(obj));

  assert.forAll((a: any, d: Diff) => {
    let b = applyDiff(a, d);
    return !!diff(a, b, d.length);
  }, ...withMutations(obj));

  assert.forAll((a: any, d: Diff) => {
    let b = applyDiff(a, d);
    let d2 = diff(a, b);
    let d3 = d2 ? diff(a, b, d2.length - 1) : [];
    return d3 && d3.length === 1;
  }, ...withMutations(obj));

  assert.forAll((a: any, d: Diff) => {
    let b = applyDiff(a, d);
    return deepEqual(applyDiff(a, diff(a, b)), b)
  }, ...withMutations(arr));
});
