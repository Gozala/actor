import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("catch/finally", () => {
  it("can recover from errors", async () => {
    const notFound = new RangeError("File not found")
    const readFile = () => {
      throw notFound
    }

    const work = function* () {
      try {
        readFile()
        return {}
      } catch (error) {
        yield* Task.send("catching error")
        yield* Task.send(error)
        yield* Task.send("recovered")
      } finally {
        yield* Task.sleep(1)
        yield* Task.send("cleaned up")
        return {}
      }
    }

    const main = function* () {
      const boom = Task.fork(work())
      return yield* Task.join([boom, Task.fork(Task.sleep(2))])
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: true,
      value: [{}, {}],
      mail: ["catching error", notFound, "recovered", "cleaned up"],
    })
  })

  it("can finalize on uncaught error", async () => {
    const notFound = new RangeError("File not found")
    const readFile = () => {
      throw notFound
    }

    const work = function* () {
      try {
        readFile()
      } finally {
        yield* Task.sleep(1)
        yield* Task.send("cleaned up")
      }
    }

    const main = function* () {
      const boom = Task.fork(work())
      yield* Task.join([boom, Task.fork(Task.sleep(2))])
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: notFound,
      mail: ["cleaned up"],
    })
  })

  it("can throw from finalizer", async () => {
    const notFound = new RangeError("File not found")
    const boom = new Error("boom")
    const readFile = () => {
      throw notFound
    }

    const work = function* () {
      try {
        readFile()
      } finally {
        try {
          yield* Task.sleep(1)
          yield* Task.send("clean up")
          throw boom
        } finally {
          yield* Task.send("finalizing")
          yield* Task.sleep(1)
          yield* Task.send("finalized")
        }
      }
    }

    const main = function* () {
      return yield* Task.join([Task.fork(work())])
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: boom,
      mail: ["clean up", "finalizing", "finalized"],
    })
  })

  it("error aborts other tasks", async () => {
    const notFound = new RangeError("File not found")
    const boom = new Error("boom")
    const readFile = () => {
      throw notFound
    }

    const crash = function* () {
      readFile()
    }

    const fail = function* () {
      yield* Task.sleep(2)
    }

    const recover = function* () {
      try {
        yield* Task.sleep(1)
      } catch (error) {
        yield* Task.send({ catch: error })
        yield* Task.sleep(1)
        yield* Task.send({ recover: error })
      } finally {
        yield* Task.send("finalizing")
        yield* Task.sleep(1)
        yield* Task.send("finalized")
      }
    }

    const main = function* () {
      return yield* Task.join([
        Task.fork(recover()),
        Task.fork(fail()),
        Task.fork(crash()),
      ])
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: notFound,
      mail: [
        { catch: notFound },
        { recover: notFound },
        "finalizing",
        "finalized",
      ],
    })
  })
})
