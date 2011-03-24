### vim:set ts=2 sw=2 sts=2 et autoread ###

'use strict'

{ when: When, defer: Deferred } = require 'q'
{ Actor } = require 'actor'
{ setTimeout } = require 'event-queue'

getNameAsync = (name='User', time=1000) ->
  { resolve, promise } = new Deferred
  setTimeout resolve, time, name
  promise

exports.actor = new Actor (name, time) ->
  console.log '>>> Task started'
  console.log 'Hello ' + (yield getNameAsync name, time)
  console.log '<<< Task finished'
  return

exports.example = (name, time) -> exports.actor.start name, time
