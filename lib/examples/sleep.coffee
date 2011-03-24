### vim:set ts=2 sw=2 sts=2 et autoread ###

'use strict'

{ when: When, defer: Deferred } = require 'q'
{ Actor } = require 'actor'
{ setTimeout } = require 'event-queue'

sleep = (time) ->
  { resolve, promise } = new Deferred
  setTimeout resolve, time
  promise

exports.actor = new Actor (time=1000) ->
  console.log '>>> Task started'
  yield sleep time # suspend task for some `time`
  console.log '<<< Task finished'
  return

exports.example = (time) -> exports.actor.start time
