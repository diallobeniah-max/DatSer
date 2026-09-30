import { MEMBER_SAVE_STATES } from './memberSaveState'

// Serializes a service instance's local journal/projection pairs. PREPARED
// records provide the cross-tab and crash boundary; this queue closes the
// same-instance window where a concurrent sync could observe an incomplete
// projection.
export const createDurableMutationWriteQueue = () => {
  let tail = Promise.resolve()
  return {
    run(work) {
      const result = tail.then(work)
      tail = result.catch(() => {})
      return result
    },
    wait() {
      return tail
    },
  }
}

// The prepared journal row is the durable first stage. Never remove it if the
// optimistic projection fails; startup recovery can replay the projection.
export const persistPreparedMutationFirst = async ({ mutations, mutation, project, updatedAt }) => {
  await mutations.insert({ ...mutation, save_state: MEMBER_SAVE_STATES.PREPARED })
  await project()
  if (mutation.operation === 'cancel_local_member_v2') return
  const journal = await mutations.findOne(mutation.id).exec()
  if (!journal) throw new Error('Durable Member V2 mutation intent disappeared before it was queued.')
  await journal.incrementalPatch({ save_state: MEMBER_SAVE_STATES.LOCAL_PENDING, updated_at: updatedAt })
}
