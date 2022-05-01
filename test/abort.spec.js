import * as Task from "../src/scratch.js"
import { assert, createLog, inspect } from "./util.js"

describe("abortion", () => {
  it("abort fork", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      log("sleep worker")
      yield* Task.sleep(3)
      log("wake work")
    }

    function* main() {
      log("begin main")
      const fork = yield* Task.fork(worker())
      yield* fork.abort(reason)
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: undefined,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["begin main", "sleep worker", "end main"])
  })

  it("catch abort fork", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      try {
        log("sleep worker")
        yield* Task.sleep(3)
        log("wake worker")
      } catch (error) {
        log("abort worker")
      }
      log("end worker")
    }

    function* main() {
      log("begin main")
      const fork = yield* Task.fork(worker())
      yield* fork.abort(reason)
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: undefined,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, [
      "begin main",
      "sleep worker",
      "end main",
      "abort worker",
      "end worker",
    ])
  })

  it("finally abort fork", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* worker() {
      try {
        log("sleep worker")
        yield* Task.sleep(3)
        log("wake worker")
      } finally {
        log("clear worker")
      }
      log("end worker")
    }

    function* main() {
      log("begin main")
      const fork = yield* Task.fork(worker())
      yield* fork.abort(reason)
      log("end main")
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      mail: [],
      value: undefined,
    })

    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, [
      "begin main",
      "sleep worker",
      "end main",
      "clear worker",
    ])
  })

  it("abort main", async () => {
    const reason = new Error("abort")
    const { log, output } = createLog()

    function* main() {
      yield* Task.abort(reason)
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: reason,
      mail: [],
    })
  })

  it("joined tasks delegate messages", async () => {
    const abort = new Error("abort")
    function* work(name = "anonymous") {
      yield* Task.send(name)
      yield* Task.sleep()
    }

    function* main() {
      const workers = ["alice", "bob", "jordan"].map(name =>
        Task.fork(work(name))
      )

      yield* Task.join(...workers)
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: undefined,
      mail: ["alice", "bob", "jordan"],
    })
  })

  it("failed task fails join", async () => {
    const boom = new Error("boom")

    function* fail() {
      yield* Task.sleep()
      throw boom
    }

    function* succeed(value = 0) {
      yield* Task.sleep()
      return value
    }

    function* main() {
      const ok = Task.fork(succeed(5))
      const error = Task.fork(fail())

      yield* Task.join(ok, error)
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("can collect results", async () => {
    function* inc(n = 0) {
      yield* Task.send(n)
      return n + 1
    }

    function* main() {
      const a = yield* Task.fork(inc(5))
      const b = yield* Task.fork(inc(16))

      const result = yield* Task.join(a, b)
      return result
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: [6, 17],
      mail: [],
    })
  })
})
