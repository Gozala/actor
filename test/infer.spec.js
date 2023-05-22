import * as Task from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe("inference", () => {
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
