'use strict'

var q = require('q'), when = q.when, defer = q.defer
  , Trait = require('light-traits').Trait

function failure(reason) {
  var error = new Error(String(reason))
  error.reason = reason
  return error
}

// Function used for continuation passing when message is resolved.
function Reactor(actor, params) {
  var act = actor.act.apply(actor, params)
  function reactor(message) {
    if (StopIteration == message) act = null
    else if (act) {
      // If promise is passed to a generator continue once it's fulfilled or
      // broken.
      try {
        when(act.send(message), reactor, failure)
      } catch(exception) {
        if (exception != StopIteration) throw exception
        else act = null
      }
    }
  }
}
// Internal API that is used by an actor instance.
var ActorInternals =
  // Array of sent, but not yet requested, messages.
{ _inbox: { get: function _inbox() {
    Object.defineProperty(this, '_inbox', { value: [], configurable: false })
    return this._inbox
  }, configurable: true }
  // Array of requested, but not yet sent, messages.
, _outbox: { get: function _outbox() {
    Object.defineProperty(this, '_outbox', { value: [], configurable: false })
    return this._outbox
  }, configurable: true }
, _active: { value: false, writable: true }
}

var ActorAPI = Trait(
  // The actor's behavior is specified by implementing this method.
{ act: Trait.required
  // Sends `data` to `this` actor. If promise for this message was already
  // received by `this` actor it will be fulfilled with a `data` being passed
  // otherwise data will be placed into mailbox for an actor to receive it.
, send: function send(data) {
    var message = this._outbox.shift()
    if (!message) this._inbox.push(data)
    else message.resolve(data)
    return this
  }
  // Receives a message from this actor's mailbox.
  // If message is already present in mailbox it will be immediately returned,
  // if message has not been delivered yet, then promise will be returned which
  // will be fulfilled once message is delivered.
, receive: function receive() {
    var message = this._inbox.shift()
    if (!message) {
      var deferred = defer()
      this._outbox.push(deferred)
      message = deferred.promise
    }
    return message
  }
  // Starts `this` actor. This method is idempotent (If `this` actor is already
  // active calling this method won't have any effect).
, start: function start() {
    if (!this._active) {
      this._inbox.splice(0)
      this._outbox.splice(0)
      Reactor(this, arguments)
    }
  }
  // Stops `this` actor. This method is idempotent (If `this` actor is already
  // inactive calling this method won't have any effect).
, stop: function stop() {
    if (this._active) this.send(StopIteration)
  }
})

var ActorTrait = Trait(ActorInternals, ActorAPI)

function Actor(actor) {
  if ('function' === typeof actor) {
    actor = Object.create(Actor.prototype, { act: { value: actor } })
    actor = Actor.create(actor)
    actor = actor.start.bind(actor)
  } else {
    actor = Actor.create(actor)
  }
  return actor
}
Object.keys(ActorTrait).forEach(function (key) {
  Object.defineProperty
  ( Actor
  , key
  , Object.getOwnPropertyDescriptor(ActorTrait, key)
  )
})
Actor.create = ActorTrait.create
Actor.resolve = ActorTrait.resolve
Actor.toString = ActorTrait.toString
exports.Actor = Actor
