import { assert } from "chai"
import * as Task from "../src/lib.js"

describe("wait", () => {
  it("it does wait on non-promise", async () => {
    let isSync = true
    function* worker() {
      const message = yield* Task.wait(5)
      assert.equal(isSync, true, "expect to be sync")
      return message
    }

    const promise = new Promise((resolve, reject) =>
      inspect(worker()).then(resolve, reject)
    )

    isSync = false
    const result = await promise

    assert.deepEqual(result, { ok: true, value: 5, mail: [] })
  })

  it("does await on promise", async () => {
    let isSync = true
    function* main() {
      const message = yield* Task.wait(Promise.resolve(5))
      assert.equal(isSync, false, "expect to be async")
      return message
    }
    const fork = inspect(main())
    isSync = false
    const result = await fork

    assert.deepEqual(result, {
      ok: true,
      value: 5,
      mail: [],
    })
  })

  it("lets you yield", async () => {
    function* main() {
      /** @type {unknown} */
      const value = yield 5
      assert.equal(value, undefined, "return undefined on normal yield")
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      value: undefined,
      ok: true,
      mail: [5],
    })
  })

  it("does throw on failed promise", async () => {
    const boom = new Error("boom!")
    function* main() {
      const message = yield* Task.wait(Promise.reject(boom))
      return message
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch promise errors", async () => {
    const boom = new Error("boom!")
    function* main() {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } catch (error) {
        return error
      }
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("can intercept thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    function* main() {
      fail()
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    function* main() {
      try {
        fail()
      } catch (error) {
        return error
      }
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("use finally", async () => {
    const boom = new Error("boom!")
    let finalized = false
    function* main() {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } finally {
        finalized = true
      }
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })

    assert.equal(finalized, true)
  })
})

describe("messaging", () => {
  it("can send message", async () => {
    function* main() {
      yield* Task.send("one")
      yield* Task.send("two")
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two"],
    })
  })

  it("can send message in finally", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
      } finally {
        yield* Task.send("three")
      }
    }
    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two", "three"],
    })
  })
  it("can send message after exception", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        // yield * Task.wait(Promise.reject('boom'))
        throw "boom"
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    }
    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("four")
      }
    }
    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two"],
    })
  })

  it("subtasks can send messages", async () => {
    function* worker() {
      yield* Task.send("c1")
    }

    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* worker()
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("five")
      }
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two", "c1", "three", "four"],
    })
  })
})

describe("subtasks", () => {
  it("crashes parent", async () => {
    /**
     * @param {Task.Await<number>} x
     * @param {Task.Await<number>} y
     */
    function* worker(x, y) {
      return (yield* Task.wait(x)) + (yield* Task.wait(y))
    }

    function* main() {
      const one = yield* worker(1, 2)
      const two = yield* worker(Promise.reject(5), one)
      return two
    }
    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: 5,
      mail: [],
    })
  })

  it("fork does not crash parent", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* worker(id) {
      log(`start ${id}`)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject("boom"))
      return 0
    }

    function* main() {
      yield* Task.fork(worker("A"))
      yield* Task.wait(Promise.resolve("one"))
      yield* Task.fork(worker("B"))
      return yield* Task.wait(Promise.resolve("two"))
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      value: "two",
      mail: [],
    })
    assert.deepEqual(output, ["start A", "start B"])
  })

  it("waiting on forks result crashes parent", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* worker(id) {
      log(`Start ${id}`)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject(`${id}!boom`))
    }

    function* main() {
      yield* Task.fork(worker("A"))
      yield* Task.wait(Promise.resolve("one"))
      const b = yield* Task.fork(worker("B"))
      yield* Task.send("hi")
      yield* Task.group(b)
      yield* Task.wait(Promise.resolve("two"))

      return 0
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "B!boom",
      mail: ["hi", "B#1"],
    })
    assert.deepEqual(output, ["Start A", "Start B"])
  })
})

describe("concurrency", () => {
  it("can run tasks concurrently", async () => {
    /**
     * @param {string} name
     * @param {number} duration
     * @param {number} count
     */
    function* worker(name, duration, count) {
      let n = 0
      while (n++ < count) {
        yield* Task.sleep(duration)
        yield* Task.send(`${name}#${n}`)
      }
    }

    function* main() {
      const a = yield* Task.fork(worker("a", 5, 6))
      yield* Task.sleep(5)
      const b = yield* Task.fork(worker("b", 7, 7))

      yield* Task.group(a, b)
    }

    const result = await inspect(main())
    const { mail } = result
    assert.deepEqual(
      [...mail].sort(),
      [
        "a#1",
        "a#2",
        "a#3",
        "a#4",
        "a#5",
        "a#6",
        "b#1",
        "b#2",
        "b#3",
        "b#4",
        "b#5",
        "b#6",
        "b#7",
      ],
      "has all the items"
    )
    assert.notDeepEqual([...mail].sort(), mail, "messages are not ordered")
  })

  it("can fork and join", async () => {
    const { output, log } = createLog()
    /**
     * @param {string} name
     */
    function* worker(name) {
      log(`> ${name} sleep`)
      yield* Task.sleep(5)
      log(`< ${name} wake`)
    }

    function* actor() {
      log("Spawn A")
      const a = yield* Task.fork(worker("A"))

      log("Sleep")
      yield* Task.sleep(20)

      log("Spawn B")
      const b = yield* Task.fork(worker("B"))

      log("Join")
      const merge = Task.group(a, b)
      yield* merge

      log("Nap")
      yield* Task.sleep(2)

      log("Exit")
    }

    await Task.promise(Object.assign(actor(), { tag: "🤖" }))

    assert.deepEqual(
      [...output],
      [
        "Spawn A",
        "Sleep",
        "> A sleep",
        "< A wake",
        "Spawn B",
        "Join",
        "> B sleep",
        "< B wake",
        "Nap",
        "Exit",
      ]
    )
  })

  it("spawn can outlive parent", async () => {
    const { output, log } = createLog()
    const worker = function* () {
      console.log("start worker")
      log("start fork")
      yield* Task.sleep(2)
      log("exit fork")
    }

    const main = function* () {
      log("start main")
      yield* Task.spawn(worker())
      log("exit main")
    }

    await Task.promise(main())
    // assert.deepEqual(output, ["start main", "exit main", "start fork"])

    await Task.promise(Task.sleep(20))

    assert.deepEqual(output, [
      "start main",
      "exit main",
      "start fork",
      "exit fork",
    ])
  })
})

describe("type level errors", () => {
  it("must yield* not yield", async () => {
    const main = function* () {
      yield Task.sleep(2)
    }

    const error = () => {
      // @ts-expect-error - Tells you to use yield*
      Task.execute(main())
    }
  })

  it("must yield* not yield", async () => {
    const worker = function* () {}
    const main = function* () {
      // @ts-expect-error tels you to use worker()
      yield Task.spawn(worker)
    }
  })
})

describe("can abort", () => {
  it("can terminate sleeping task", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const task = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("terminate worker")
      yield* Task.terminate(task)
      log("exit main")
    }

    function* worker() {
      log("start worker")
      yield* Task.sleep(20)
      log("wake worker")
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "terminate worker",
      "exit main",
    ]

    await Task.promise(main())
    assert.deepEqual(output, expect)
    await Task.promise(Task.sleep(30))

    assert.deepEqual(output, expect)
  })

  it("sleeping task can still cleanup", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const task = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("abort worker")
      yield* Task.terminate(task)
      log("exit main")
    }

    function* worker() {
      log("start worker")

      const id = setTimeout(() => {
        log("timeout fired")
      }, 10)

      try {
        yield* Task.suspend()
      } finally {
        clearTimeout(id)
        log("can clean up even though aborted")
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "abort worker",
      "can clean up even though aborted",
      "exit main",
    ]

    await Task.promise(main())
    await Task.promise(Task.sleep(30))

    assert.deepEqual(output, expect)
  })

  it("can abort with an error", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const fork = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("abort worker")
      yield* Task.abort(fork, new Error("kill"))
      log("exit main")
    }

    function* worker() {
      try {
        log("start worker")
        yield* Task.sleep(20)
        log("wake worker")
      } catch (error) {
        log(`aborted ${error}`)
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "abort worker",
      "aborted Error: kill",
      "exit main",
    ]

    await Task.promise(main())
    assert.deepEqual(output, expect)
    await Task.promise(Task.sleep(30))

    assert.deepEqual(output, expect)
  })

  it("can still do things when aborted", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const fork = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("abort worker")
      yield* Task.abort(fork, new Error("kill"))
      log("exit main")
    }

    function* worker() {
      try {
        log("start worker")
        yield* Task.sleep(20)
        log("wake worker")
      } catch (error) {
        log(`aborted ${error}`)
        yield* Task.sleep(2)
        log("ok bye")
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "abort worker",
      "aborted Error: kill",
      "exit main",
    ]

    await Task.promise(main())
    assert.deepEqual(output, expect)
    await Task.promise(Task.sleep(10))

    assert.deepEqual(output, [...expect, "ok bye"])
  })

  it("can still suspend after aborted", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const fork = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("abort worker")
      yield* Task.abort(fork, new Error("kill"))
      log("exit main")
    }

    function* worker() {
      const task = yield* Task.current()
      try {
        log("start worker")
        yield* Task.sleep(20)
        log("wake worker")
      } catch (error) {
        log(`aborted ${error}`)
        setTimeout(Task.resume, 2, task)
        log("suspend after abort")
        yield* Task.suspend()
        log("ok bye now")
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "abort worker",
      "aborted Error: kill",
      "suspend after abort",
      "exit main",
    ]

    await Task.promise(main())
    assert.deepEqual(output, expect)
    await Task.promise(Task.sleep(10))

    assert.deepEqual(output, [...expect, "ok bye now"])
  })

  it("can exit the task", async () => {
    let { output, log } = createLog()
    function* main() {
      log("fork worker")
      const fork = yield* Task.fork(worker())
      log("nap")
      yield* Task.sleep(1)
      log("exit worker")
      yield* Task.exit(fork, 0)
      log("exit main")
    }

    function* worker() {
      try {
        log("start worker")
        yield* Task.sleep(20)
        log("wake worker")
        return 0
      } catch (error) {
        log(`aborted ${error}`)
        return 1
      }
    }

    const expect = [
      "fork worker",
      "nap",
      "start worker",
      "exit worker",
      "exit main",
    ]

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(30))

    assert.deepEqual(output, expect)
  })
})

describe("promise", () => {
  it("fails promise if task fails", async () => {
    function* main() {
      throw new Error("boom")
    }

    try {
      const result = await Task.fork(main())
      assert.fail("should be unreachable")
    } catch (error) {
      assert.match(String(error), /boom/)
    }
  })
})

describe("tag", () => {
  it("tags effect", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(2)

      yield* Task.send(2)
    }

    const result = await inspect(Task.tag(fx(), "fx"))
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [
        { type: "fx", fx: 1 },
        { type: "fx", fx: 2 },
      ],
    })
  })

  it("tags with errors", async () => {
    const error = new Error("boom")
    function* fx() {
      yield* Task.send(1)
      throw error
    }

    function* main() {
      yield* Task.tag(fx(), "fx")
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: false,
      error,
      mail: [{ type: "fx", fx: 1 }],
    })
  })

  it("can terminate tagged", async () => {
    const { output, log } = createLog()
    function* fx() {
      yield* Task.send(1)
      log("send 1")
      yield* Task.sleep(1)
      yield* Task.send(2)
      log("send 2")
    }

    function* main() {
      const fork = yield* Task.fork(Task.tag(fx(), "fx"))
      yield* Task.sleep(1)
      yield* Task.terminate(fork)
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["send 1"])
    await Task.promise(Task.sleep(5))

    assert.deepEqual(output, ["send 1"])
  })

  it("can abort tagged", async () => {
    const { output, log } = createLog()
    function* fx() {
      yield* Task.send(1)
      log("send 1")
      yield* Task.sleep(1)
      yield* Task.send(2)
      log("send 2")
    }

    function* main() {
      const fork = yield* Task.fork(Task.tag(fx(), "fx"))
      yield* Task.sleep(1)
      yield* Task.abort(fork, new Error("kill"))
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["send 1"])
    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["send 1"])
  })
})

describe("listen", () => {
  it("can listen to several fx", async () => {
    /**
     * @param {number} delay
     * @param {number} count
     */
    function* source(delay, count) {
      let start = Date.now()
      let n = 0
      while (n < count) {
        yield* Task.send(n)
        n++
        yield* Task.sleep(delay)
      }
    }

    const fx = Task.listen({
      beep: source(3, 5),
      bop: source(5, 3),
      buz: source(2, 2),
    })

    const { mail, ...result } = await inspect(fx)
    assert.deepEqual(result, { ok: true, value: undefined })
    const inbox = mail.map(m => JSON.stringify(m))

    const expect = [
      { type: "beep", beep: 0 },
      { type: "beep", beep: 1 },
      { type: "beep", beep: 2 },
      { type: "beep", beep: 3 },
      { type: "beep", beep: 4 },
      { type: "bop", bop: 0 },
      { type: "bop", bop: 1 },
      { type: "bop", bop: 2 },
      { type: "buz", buz: 0 },
      { type: "buz", buz: 1 },
    ]

    assert.notDeepEqual(
      [...inbox].sort(),
      inbox,
      "messages aren not ordered by actors"
    )
    assert.deepEqual(
      [...inbox].sort(),
      [...expect.map(v => JSON.stringify(v))].sort(),
      "all messages were received"
    )
  })
})

/**
 * @template T, X, M
 * @param {Task.Actor<T, X, M>} task
 */
const inspect = task => Task.fork(inspector(task))

/**
 * @template T, X, M
 * @param {Task.Actor<T, X, M>} task
 * @returns {Task.Task<{ ok: boolean, value?: T, error?: X, mail: M[] }, never>}
 */
const inspector = function* (task) {
  /** @type {M[]} */
  const mail = []
  let input
  try {
    while (true) {
      const step = task.next(input)
      if (step.done) {
        return { ok: true, value: step.value, mail }
      } else {
        const instruction = step.value
        if (Task.isInstruction(instruction)) {
          input = yield instruction
        } else {
          mail.push(/** @type {M} */ (instruction))
        }
      }
    }
  } catch (error) {
    return { ok: false, error: /** @type {X} */ (error), mail }
  }
}

const createLog = () => {
  /** @type {string[]} */
  const output = []
  return {
    output,
    /**
     * @param {string} message
     */
    log(message) {
      output.push(message)
    },
  }
}
// describe('continuation', () => {
//   it('can raise errors', () => {
//     expect(() => evaluate(function * () {
//       yield * shift(function * (k) {
//         k.throw(new Error('boom!'))
//       })
//     })).to.throw('boom!')
//   })

//   it('can catch errors', () => {
//     expect(evaluate(function * () {
//       try {
//         yield * shift(function * (k) {
//           return k.throw(new Error('boom!'))
//         })
//         return 'did not throw'
//       } catch (error) {
//         return Object(error).message
//       }
//     })).to.equal('boom!')
//   })

//   it('allows you to return', () => {
//     expect(evaluate(function * () {
//       yield * shift(function * (k) {
//         return k.return('hello')
//       })
//     })).to.equal('hello')
//   })
// })

// describe('capture', () => {
//   it('can capture completed operations', () => {
//     expect(evaluate(() => capture(function * () { return 5 })))
//       .to.deep.equal({ ok: true, value: 5 })
//   })

//   it('can capture errored operations', () => {
//     const boom = new Error('boom')
//     const task = capture(function * () { throw boom })
//     const result = evaluate(() => task)

//     expect(result)
//       .to.deep.equal({ ok: false, error: boom })
//   })
// })

// describe('sleep', () => {
//   it('can sleep', async () => {
//     const result = evaluate(function * () {
//       console.log('start')
//       const start = Date.now()
//       console.log('sleep')
//       yield * FX.sleep(500)
//       console.log('awake')
//       const end = Date.now()

//       console.log('done', { start, end })
//       return start - end
//     })

//     console.log(result)

//     await new Promise(() => {

//     })

//     expect(result).to.be.greaterThanOrEqual(500)
//   })
// })
