import { describe, expect, it, vi } from 'vitest'
import { createAttendanceWriteQueue } from './attendanceWriteQueue'

describe('createAttendanceWriteQueue', () => {
  it('serializes rapid choices for one member and Sunday in tap order', async () => {
    const queue = createAttendanceWriteQueue()
    const writes = []
    let releaseFirst
    const firstGate = new Promise((resolve) => { releaseFirst = resolve })

    const present = queue.enqueue('August_2026:member-1:2026-08-16', async ({ isLatest }) => {
      writes.push('Present:start')
      await firstGate
      writes.push(`Present:${isLatest() ? 'latest' : 'superseded'}`)
      return 'Present'
    })
    const absent = queue.enqueue('August_2026:member-1:2026-08-16', async ({ isLatest }) => {
      writes.push(`Absent:${isLatest() ? 'latest' : 'superseded'}`)
      return 'Absent'
    })

    await vi.waitFor(() => expect(writes).toEqual(['Present:start']))
    releaseFirst()

    await expect(present.promise).resolves.toBe('Present')
    await expect(absent.promise).resolves.toBe('Absent')
    expect(writes).toEqual(['Present:start', 'Present:superseded', 'Absent:latest'])
  })

  it('keeps a later write runnable after an earlier write fails', async () => {
    const queue = createAttendanceWriteQueue()
    const secondWrite = vi.fn().mockResolvedValue('Absent')

    const first = queue.enqueue('January_2026:member-1:2026-01-11', async () => {
      throw new Error('temporary failure')
    })
    const second = queue.enqueue('January_2026:member-1:2026-01-11', secondWrite)

    await expect(first.promise).rejects.toThrow('temporary failure')
    await expect(second.promise).resolves.toBe('Absent')
    expect(secondWrite).toHaveBeenCalledTimes(1)
  })

  it('does not serialize different Sundays together', async () => {
    const queue = createAttendanceWriteQueue()
    const first = vi.fn().mockResolvedValue('Present')
    const second = vi.fn().mockResolvedValue('Absent')

    await Promise.all([
      queue.enqueue('January_2026:member-1:2026-01-04', first).promise,
      queue.enqueue('January_2026:member-1:2026-01-11', second).promise
    ])

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
