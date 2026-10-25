import { test, expect } from '@playwright/test'

// Real components and CSS; no Auth/App provider or database writes.
async function bootstrapFeedback(options) {
  const {default:React}=await import('/node_modules/.vite/deps/react.js')
  const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js')
  const {createRoot}=ReactDOM
  const {default:RefreshRuntime}=await import('/@react-refresh')
  RefreshRuntime.injectIntoGlobalHook(window)
  window.$RefreshReg$=()=>{}
  window.$RefreshSig$=()=>type=>type
  window.__vite_plugin_react_preamble_installed__=true
  const {default:MemberCard}=await import('/src/components/MemberCard.jsx')
  const {default:AttendanceChoice}=await import('/src/components/AttendanceChoice.jsx')
  document.documentElement.classList.toggle('dark',options.dark)
  const dates=['2026-01-04','2026-01-11']
  const members=[{id:'feedback-1',full_name:'Synthetic Feedback One'},{id:'feedback-2',full_name:'Synthetic Feedback Two'}]
  const initialData={[dates[0]]:{'feedback-1':options.initial},[dates[1]]:{'feedback-1':false,'feedback-2':true}}
  const noop=()=>{}
  const props={isExpanded:true,monthSundays:dates,currentTable:'January_2026',getMonthDisplayName:()=> 'January 2026',onMouseDown:noop,onMouseUp:noop,onLongPressStart:noop,onLongPressMove:noop,onLongPressEnd:noop}
  function Fixture() {
    const [data,setData]=React.useState(initialData)
    const [pending,setPending]=React.useState({})
    window.__attendanceFeedback={finish:()=>setPending({}),fail:()=>{setData(initialData);setPending({})}}
    const selectDate=(id,value,date)=>{
      setData(previous=>({...previous,[date]:{...previous[date],[id]:value}}))
      setPending(previous=>({...previous,[id+'_'+date]:true}))
    }
    return React.createElement(React.Fragment,null,
      ...members.map(member=>React.createElement(MemberCard,{...props,key:member.id,member,attendanceData:data,attendanceLoadingByDate:pending,onAttendanceForDate:selectDate})),
      React.createElement(AttendanceChoice,{value:true,disabled:options.disabled,testIdPrefix:'unavailable'})
    )
  }
  createRoot(document.getElementById('fixture')).render(React.createElement(Fixture))
}


const mountFeedback = async (page, { dark = false, initial = null, disabled = false } = {}) => {
  await page.addInitScript(() => { window.__feedbackErrors = []; window.addEventListener('error', event => window.__feedbackErrors.push(event.message)) })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === 'http://127.0.0.1:5191' ? route.continue() : route.abort()
  })
  const script = '(' + bootstrapFeedback.toString() + ')(' + JSON.stringify({ dark, initial, disabled }) + ')'
  await page.route('**/__attendance-feedback', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="stylesheet" href="/src/styles/design-tokens.css?direct"><link rel="stylesheet" href="/src/index.css?direct"></head><body><div id="fixture"></div><script type="module">' + script + '</script></body></html>',
  }))
  await page.goto('/__attendance-feedback')
  await expect(page.getByTestId('member-card-attendance-feedback-1-2026-01-04-present')).toBeVisible()
}
const choice = (page, date, tone, member = 'feedback-1') =>
  page.getByTestId('member-card-attendance-' + member + '-' + date + '-' + tone)
const selectChoice = button => test.info().project.use.hasTouch ? button.tap() : button.click()

test.afterEach(async ({ page }) => { expect(await page.evaluate(() => window.__feedbackErrors || [])).toEqual([]) })

const readStyle = button => button.evaluate(element => ({
  opacity: getComputedStyle(element).opacity, background: getComputedStyle(element).backgroundColor,
}))
for (const dark of [false, true]) {
  for (const [tone, initial, background] of [
    ['present', null, 'rgb(22, 163, 74)'], ['absent', null, 'rgb(220, 38, 38)'],
    ['clear', true, dark ? 'rgb(163, 163, 163)' : 'rgb(107, 114, 128)'],
  ]) {
    test(tone + ' is strong immediately while saving and after completion (' + (dark ? 'dark' : 'light') + ')', async ({ page }) => {
      await mountFeedback(page, { dark, initial })
      const selected = choice(page, '2026-01-04', tone)
      await selectChoice(selected)
      // Direct style read: no settling delay and no second button click.
      expect(await readStyle(selected)).toEqual({ opacity: '1', background })
      await expect(selected).toHaveAttribute('aria-busy', 'true')
      await expect(selected).toBeDisabled()
      await expect(choice(page, '2026-01-11', 'absent')).toHaveAttribute('data-selected', 'true')
      await expect(choice(page, '2026-01-11', 'present', 'feedback-2')).toHaveAttribute('data-selected', 'true')
      await page.evaluate(() => window.__attendanceFeedback.finish())
      await expect(selected).toBeEnabled()
      await expect(selected).not.toHaveAttribute('aria-busy', 'true')
      expect(await readStyle(selected)).toEqual({ opacity: '1', background })
    })
  }
}
test('switching statuses and dates leaves other entries unchanged', async ({ page }) => {
  await mountFeedback(page)
  for (const [tone, background] of [
    ['present', 'rgb(22, 163, 74)'], ['absent', 'rgb(220, 38, 38)'], ['clear', 'rgb(107, 114, 128)'],
  ]) {
    const selected = choice(page, '2026-01-04', tone)
    await selectChoice(selected)
    expect(await readStyle(selected)).toEqual({ opacity: '1', background })
    for (const otherTone of ['present', 'absent', 'clear'].filter(value => value !== tone)) {
      const other = choice(page, '2026-01-04', otherTone)
      await expect(other).toHaveAttribute('data-selected', 'false')
      expect((await readStyle(other)).background).toBe('rgb(243, 244, 246)')
    }
    await page.evaluate(() => window.__attendanceFeedback.finish())
    await expect(selected).toBeEnabled()
  }
  await selectChoice(choice(page, '2026-01-11', 'present'))
  expect(await readStyle(choice(page, '2026-01-11', 'present'))).toEqual({ opacity: '1', background: 'rgb(22, 163, 74)' })
  await expect(choice(page, '2026-01-04', 'clear')).toHaveAttribute('data-selected', 'true')
  await expect(choice(page, '2026-01-11', 'present', 'feedback-2')).toHaveAttribute('data-selected', 'true')
})
test('rollback removes failed selection and releases the busy state', async ({ page }) => {
  await mountFeedback(page)
  await selectChoice(choice(page, '2026-01-04', 'present'))
  await page.evaluate(() => window.__attendanceFeedback.fail())
  const failed = choice(page, '2026-01-04', 'present')
  await expect(failed).toHaveAttribute('data-selected', 'false')
  await expect(failed).toBeEnabled()
  expect((await readStyle(failed)).background).toBe('rgb(243, 244, 246)')
  await expect(choice(page, '2026-01-04', 'clear')).toHaveAttribute('data-selected', 'true')
})
test('an explicitly unavailable control remains disabled and faded', async ({ page }) => {
  await mountFeedback(page, { disabled: true })
  const unavailable = page.getByTestId('unavailable-present')
  await expect(unavailable).toBeDisabled()
  expect((await readStyle(unavailable)).opacity).toBe('0.58')
})
