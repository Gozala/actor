import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

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
    function* work(id) {
      log(`start ${id}`)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject("boom"))
      return 0
    }

    function* main() {
      yield* Task.fork(work("A"))
      yield* Task.wait(Promise.resolve("one"))
      yield* Task.fork(work("B"))
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
      const a = yield* Task.fork(worker("A"))
      yield* Task.wait(Promise.resolve("one"))
      const b = yield* Task.fork(worker("B"))
      yield* Task.send("hi")
      yield* Task.group([a, b])
      yield* Task.wait(Promise.resolve("two"))

      return 0
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: false,
      error: "A!boom",
      mail: ["hi", "B#1"],
    })
    assert.deepEqual(output, ["Start A", "Start B"])
  })

  it("joining failed forks crashes parent", async () => {
    const { output, log } = createLog()

    /**
     * @param {string} id
     */
    function* work(id) {
      log(`Start ${id}`)
      yield* Task.send(`${id}#1`)
      return id
    }

    function* main() {
      const a = yield* Task.fork(work("A"))
      yield* Task.wait(Promise.resolve("one"))
      const b = yield* Task.fork(work("B"))
      yield* Task.send("hi")
      // yield* Task.sleep(20)

      const result = yield* Task.join(b)
      assert.deepEqual(result, "B")

      const result2 = yield* Task.join(a)
      assert.deepEqual(result2, "A")
    }

    const result = await inspect(main())

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["hi", "B#1"],
    })
    assert.deepEqual(output, ["Start A", "Start B"])
  })

  it("faling group member terminates group", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")
    function* work(ms = 0, name = "", crash = false) {
      log(`${name} on duty`)
      if (crash) {
        yield* Task.sleep(ms)
        throw boom
      }

      try {
        yield* Task.sleep(ms)
        log(`${name} is done`)
      } finally {
        log(`${name} cancelled`)
      }
    }

    function* main() {
      const a = yield* Task.fork(work(1, "A"))
      yield* Task.sleep(2)
      const b = yield* Task.fork(work(8, "B"))
      const c = yield* Task.fork(work(14, "C"))
      const d = yield* Task.fork(work(4, "D", true))
      const e = yield* Task.fork(work(10, "E"))

      try {
        yield* Task.group([a, b, c, d, e])
      } catch (error) {
        yield* Task.sleep(30)
        return { error }
      }
    }

    assert.deepEqual(await inspect(main()), {
      ok: true,
      value: { error: boom },
      mail: [],
    })

    assert.deepEqual(
      [...output].sort(),
      [
        "A on duty",
        "B on duty",
        "C on duty",
        "D on duty",
        "E on duty",
        "A is done",
        "E cancelled",
        "A cancelled",
        "B cancelled",
        "C cancelled",
      ].sort()
    )
  })

  it("failed task fails the group", async () => {
    const { output, log } = createLog()
    const boom = new Error("boom")

    function* fail(error = boom) {
      throw error
    }
    function* work(ms = 0, name = "") {
      log(`${name} on duty`)

      try {
        yield* Task.sleep(ms)
        log(`${name} is done`)
      } finally {
        log(`${name} cancelled`)
      }
    }

    function* main() {
      const f = yield* Task.fork(fail(boom))
      const a = yield* Task.fork(work(2, "a"))
      yield* Task.sleep()
      assert.deepEqual(f.result, { ok: false, error: boom })
      yield* Task.group([
        a,
        yield* Task.fork(work(4, "b")),
        f,
        yield* Task.fork(work(2, "c")),
      ])
    }

    assert.deepEqual(await inspect(main()), {
      ok: false,
      error: boom,
      mail: [],
    })
    await Task.fork(Task.sleep(10))
    assert.deepEqual(output, ["a on duty", "a cancelled"])
  })

  it("can make empty group", async () => {
    function* main() {
      return yield* Task.group([])
    }

    assert.deepEqual(await inspect(main()), {
      ok: true,
      value: undefined,
      mail: [],
    })
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

      yield* Task.group([a, b])
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
    function* work(name) {
      log(`> ${name} sleep`)
      yield* Task.sleep(5)
      log(`< ${name} wake`)
    }

    function* main() {
      log("Spawn A")
      const a = yield* Task.fork(work("A"))

      log("Sleep")
      yield* Task.sleep(20)

      log("Spawn B")
      const b = yield* Task.fork(work("B"))

      log("Join")
      const merge = Task.group([a, b])
      yield* merge

      log("Nap")
      yield* Task.sleep(2)

      log("Exit")
    }

    await Task.fork(main(), { name: "🤖" })

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

  it("joining failed task throws", async () => {
    const boom = new Error("boom")
    function* work() {
      throw boom
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(0)

      yield* Task.join(worker)
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: false,
      error: boom,
      mail: [],
    })
  })
  it("spawn can outlive parent", async () => {
    const { output, log } = createLog()
    const worker = function* () {
      log("start fork")
      yield* Task.sleep(2)
      log("exit fork")
    }

    const main = function* () {
      log("start main")
      yield* Task.spawn(worker())
      log("exit main")
    }

    await Task.fork(main())
    // assert.deepEqual(output, ["start main", "exit main", "start fork"])

    await Task.fork(Task.sleep(20))

    assert.deepEqual(output, [
      "start main",
      "exit main",
      "start fork",
      "exit fork",
    ])
  })

  it("throws on exit", async () => {
    const boom = new Error("boom")
    function* work() {
      try {
        yield* Task.sleep(5)
      } finally {
        throw boom
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep()
      yield* Task.exit(worker, undefined)
    }

    assert.deepEqual(await inspect(main()), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })
})

describe("type level errors", () => {
  it("must yield* not yield", async () => {
    const main = function* () {
      yield Task.sleep(2)
    }

    const error = () => {
      // @ts-expect-error - Tells you to use yield*
      Task.fork(main())
    }
  })

  it("must yield* not yield", async () => {
    const worker = function* () {}
    const main = function* () {
      // @ts-expect-error tels you to use worker()
      yield Task.fork(worker)
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

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(30))

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

    await Task.fork(main())
    await Task.fork(Task.sleep(30))

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

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(30))

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

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(10))

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

    await Task.fork(main())
    assert.deepEqual(output, expect)
    await Task.fork(Task.sleep(10))

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

  it("can use then", async () => {
    function* work() {
      yield* Task.sleep(1)
      return 0
    }

    const result = await Task.fork(work()).then()
    assert.deepEqual(result, 0)
  })

  it("can use catch", async () => {
    const boom = new Error("boom")
    function* work() {
      yield* Task.sleep(1)
      throw boom
    }

    const result = await Task.fork(work()).catch(e => e)
    assert.deepEqual(result, boom)
  })

  it("can use finally", async () => {
    const boom = new Error("boom")
    function* work() {
      yield* Task.sleep(1)
      return 0
    }

    let invoked = false
    const result = await Task.fork(work()).finally(() => {
      invoked = true
    })

    assert.deepEqual(result, 0)
    assert.deepEqual(invoked, true)
  })

  it("has toStringTag", async () => {
    const fork = Task.fork(Task.sleep(2))
    assert.deepEqual(String(fork), "[object Fork]")
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
    await Task.fork(Task.sleep(5))

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
      const tagged = Task.tag(fx(), "fx")
      assert.equal(String(tagged), "[object TaggedEffect]")
      const fork = yield* Task.fork(tagged)
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

  it("can double tag", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(1)
      yield* Task.send(2)
    }

    const tagged = Task.tag(Task.tag(fx(), "foo"), "bar")

    assert.deepEqual(await inspect(tagged), {
      ok: true,
      value: undefined,
      mail: [
        { type: "bar", bar: { type: "foo", foo: 1 } },
        { type: "bar", bar: { type: "foo", foo: 2 } },
      ],
    })
  })

  it("tagging none is noop", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(1)
      yield* Task.send(2)
    }

    const tagged = Task.tag(Task.tag(Task.none(), "foo"), "bar")
    assert.deepEqual(await inspect(tagged), {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.equal(tagged, Task.none())
  })
})

describe("effect", () => {
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

  it("can listen to none", async () => {
    assert.deepEqual(await inspect(Task.listen({})), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can produces no messages on empty tasks", async () => {
    const { log, output } = createLog()
    function* work() {
      console.log("start work")
      yield* Task.sleep(2)
      console.log("end work")
    }
    const main = Task.listen({
      none: work(),
    })

    assert.deepEqual(await inspect(main), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can turn task into effect", async () => {
    function* work() {
      Task.sleep(1)
      return "hi"
    }

    const fx = Task.effect(work())

    assert.deepEqual(await inspect(fx), {
      ok: true,
      value: undefined,
      mail: ["hi"],
    })
  })

  it("can turn multiple tasks into effect", async () => {
    function* fx(msg = "", delay = 1) {
      yield* Task.sleep(delay)
      return msg
    }

    const effect = Task.effects([fx("foo", 5), fx("bar", 1), fx("baz", 2)])
    assert.deepEqual(await inspect(effect), {
      ok: true,
      value: undefined,
      mail: ["bar", "baz", "foo"],
    })
  })

  it("can turn 0 tasks into effect", async () => {
    const effect = Task.effects([])
    assert.deepEqual(await inspect(effect), {
      ok: true,
      value: undefined,
      mail: [],
    })
  })

  it("can batch multiple effects", async () => {
    function* fx(msg = "", delay = 1) {
      yield* Task.sleep(delay)
      yield* Task.send(msg)
    }

    const effect = Task.batch([fx("foo", 5), fx("bar", 1), fx("baz", 2)])
    assert.deepEqual(await inspect(effect), {
      ok: true,
      value: undefined,
      mail: ["bar", "baz", "foo"],
    })
  })

  it("can loop", async () => {
    const { log, output } = createLog()
    function* step({ n } = { n: 0 }) {
      log(`<< ${n}`)
      while (--n > 0) {
        log(`>> ${n}`)
        yield* Task.sleep(n)
        yield* Task.send({ n })
      }
    }

    const main = await Task.fork(Task.loop(step({ n: 4 }), step))

    assert.notDeepEqual([...output].sort(), output)
    assert.deepEqual(
      [...output].sort(),
      [
        "<< 4",
        ">> 3",
        ">> 2",
        ">> 1",
        "<< 3",
        ">> 2",
        ">> 1",
        "<< 2",
        ">> 1",
        "<< 1",
        "<< 2",
        ">> 1",
        "<< 1",
        "<< 1",
        "<< 1",
      ].sort()
    )
  })

  it("can wait in a loop", async () => {
    const { log, output } = createLog()
    const main = Task.loop(Task.send("start"), function* (message) {
      log(`<< ${message}`)
      const result = yield* Task.wait(0)
      log(`>> ${result}`)
    })

    assert.deepEqual(await Task.fork(main), undefined)
    assert.deepEqual(output, ["<< start", ">> 0"])
  })
})

describe("all operator", () => {
  it("can get all results", async () => {
    const { output, log } = createLog()

    /** @type {(d:number, r:string) => Task.Task<string, never>} */
    function* work(duration, result) {
      yield* Task.sleep(duration)
      log(result)
      return result
    }

    function* main() {
      const result = yield* Task.all([
        work(2, "a"),
        work(9, "b"),
        work(5, "c"),
        work(0, "d"),
      ])

      return result
    }

    const result = await Task.fork(main())
    assert.deepEqual(result, ["a", "b", "c", "d"])
    assert.notDeepEqual(result, output)
    assert.deepEqual([...result].sort(), [...output].sort())
  })

  it("on failur all other tasks are aborted", async () => {
    const { output, log } = createLog()

    /** @type {(d:number, n:string, c?:boolean) => Task.Task<string, never>} */
    function* work(duration, name, crash = false) {
      yield* Task.sleep(duration)
      log(name)
      if (crash) {
        throw name
      } else {
        return name
      }
    }

    function* main() {
      const result = yield* Task.all([
        work(2, "a"),
        work(9, "b"),
        work(5, "c", true),
        work(0, "d"),
        work(8, "e"),
      ])

      return result
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: false,
      error: "c",
      mail: [],
    })

    await Task.fork(Task.sleep(20))
    assert.deepEqual([...output].sort(), ["d", "a", "c"].sort())
  })

  it("can make all of none", async () => {
    assert.deepEqual(await Task.fork(Task.all([])), [])
  })
})

describe("Fork API", () => {
  it("can use abort method", async () => {
    const { output, log } = createLog()
    const kill = new Error("kill")
    function* work() {
      log("start work")
      yield* Task.sleep(2)
      log("end work")
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(0)
      log("kill")
      yield* worker.abort(kill)
      log("nap")
      yield* Task.sleep(5)
      log("exit")
    }

    await Task.fork(main())
    assert.deepEqual(output, ["start work", "kill", "nap", "exit"])
  })
  it("can use exit method", async () => {
    const { output, log } = createLog()
    const kill = new Error("kill")
    function* work() {
      try {
        log("start work")
        yield* Task.sleep(2)
        log("end work")
      } finally {
        log("cancel work")
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(0)
      log("kill")
      yield* worker.exit()
      log("nap")
      yield* Task.sleep(5)
      log("exit")
    }

    await Task.fork(main())
    assert.deepEqual(output, [
      "start work",
      "kill",
      "cancel work",
      "nap",
      "exit",
    ])
  })

  it("can use resume method", async () => {
    const { output, log } = createLog()
    function* work() {
      log("suspend work")
      yield* Task.suspend()
      log("resume work")
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(2)
      yield* worker.resume()
      log("exit")
    }

    await Task.fork(main())
    assert.deepEqual(output, ["suspend work", "exit", "resume work"])
  })

  it("can use join method", async () => {
    function* work() {
      yield* Task.send("a")
      yield* Task.sleep(2)
      yield* Task.send("b")
      return 0
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep(0)
      const result = yield* worker.join()
      return result
    }

    const result = await inspect(main())
    assert.deepEqual(result, {
      ok: true,
      value: 0,
      mail: ["b"],
    })
  })

  it("has toStringTag", async () => {
    function* main() {
      const fork = yield* Task.fork(Task.sleep(2))
      return String(fork)
    }

    assert.deepEqual(await Task.fork(main()), "[object Fork]")
  })

  it("is iterator", async () => {
    function* work() {
      yield* Task.send("a")
      yield* Task.send("b")
      yield* Task.send("c")
    }
    function* main() {
      const fork = yield* Task.fork(work())
      return [...fork]
    }

    assert.deepEqual(await Task.fork(main()), [])
  })

  it("can join non-active fork", async () => {
    function* work() {
      yield* Task.send("hi")
    }

    const worker = Task.fork(work())

    function* main() {
      yield* Task.join(worker)
    }

    assert.deepEqual(await inspect(main()), {
      mail: ["hi"],
      ok: true,
      value: undefined,
    })
  })
})

describe("hang", () => {
  it("will cleanup joined children", async () => {
    const { log, output } = createLog()
    function* hang() {
      try {
        yield* Task.suspend()
      } finally {
        log("cleanup hang")
      }
    }

    function* work() {
      try {
        const fork = yield* Task.fork(hang())
        yield* Task.join(fork)
      } finally {
        log("cleanup work")
      }
    }

    function* main() {
      const worker = yield* Task.fork(work())
      yield* Task.sleep()
      yield* Task.exit(worker, undefined)
    }

    assert.deepEqual(await inspect(main()), {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["cleanup hang", "cleanup work"])
  })
})
