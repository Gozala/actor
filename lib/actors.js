'use strict'

var q = require('q'), when = q.when, defer = q.defer

function failure(reason) {
  var error = new Error(String(reason))
  error.reason = reason
  return error
}

var DActor = (
{ act: { value: function act() {
    var actor = this.apply(null, arguments)
    ;(function process(message) {
      if (message == StopIteration) return
      try {
        when(actor.send(message), process, failure)
      } catch(exception) {
        if (exception != StopIteration) throw exception
      }
    })()
  }, enumerable: true }
, post: { value: function post(data) {
    var message = this.inbox.shift()
    if (!message) this.outbox.push(data)
    else message.resolve(data)
    return this
  }, enumerable: true }
, receive: { value: function receive() {
    var message = this.outbox.shift()
    if (!message) {
      var deferred = defer()
      this.inbox.push(deferred)
      message = deferred.promise
    }
    return message
  }}
, exit: { value: function exit() {
    this.post(StopIteration)
  }, enumerable: true }
})

exports.Actor = function Actor(actor) {
  Object.defineProperties(actor, DActor)
  Object.defineProperties(actor,
  { inbox: { value: [] }
  , outbox: { value: [] }
  })
  return Object.freeze(actor)
}
