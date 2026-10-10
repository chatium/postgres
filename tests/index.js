/* eslint no-console: 0 */

const { t, not, ot } = require('./test.js') // eslint-disable-line
const cp = require('child_process')
const path = require('path')
const net = require('net')

/** @type {import('../types')} */
const postgres = require('../lib')
const delay = ms => new Promise(r => setTimeout(r, ms))

const login = {
  user: 'postgres_js_test'
}

const login_clear = {
  user: 'postgres_js_test_clear',
  pass: 'postgres_js_test_clear'
}

const login_md5 = {
  user: 'postgres_js_test_md5',
  pass: 'postgres_js_test_md5'
}

const login_scram = {
  user: 'postgres_js_test_scram',
  pass: 'postgres_js_test_scram'
}

const options = {
  db: 'postgres_js_test',
  user: login.user,
  pass: login.pass,
  idle_timeout: 0.2,
  debug: false,
  max: 1
}

cp.execSync('dropdb ' + options.db + ';createdb ' + options.db)
;[login, login_clear, login_md5, login_scram].forEach(x =>
  cp.execSync('psql -c "grant all on database ' + options.db + ' to ' + x.user + '"')
)

const sql = postgres(options)

t('Connects with no options', async() => {
  const sql = postgres()

  const result = (await sql`select 1 as x`)[0].x
  await sql.end()

  return [1, result]
})

t('Uses default database without slash', async() =>
  ['postgres', postgres('postgres://localhost').options.database]
)

t('Uses default database with slash', async() =>
  ['postgres', postgres('postgres://localhost/').options.database]
)

t('Result is array', async() =>
  [true, Array.isArray(await sql`select 1`)]
)

t('Result has count', async() =>
  [1, (await sql`select 1`).count]
)

t('Result has command', async() =>
  ['SELECT', (await sql`select 1`).command]
)

t('Create table', async() =>
  ['CREATE TABLE', (await sql`create table test(int int)`).command, await sql`drop table test`]
)

t('Drop table', async() => {
  await sql`create table test(int int)`
  return ['DROP TABLE', (await sql`drop table test`).command]
})

t('null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Integer', async() =>
  ['1', (await sql`select ${ 1 } as x`)[0].x]
)

t('String', async() =>
  ['hello', (await sql`select ${ 'hello' } as x`)[0].x]
)

t('Boolean false', async() =>
  [false, (await sql`select ${ false } as x`)[0].x]
)

t('Boolean true', async() =>
  [true, (await sql`select ${ true } as x`)[0].x]
)

t('Date', async() => {
  const now = new Date()
  return [0, now - (await sql`select ${ now } as x`)[0].x]
})

t('Json', async() => {
  const x = (await sql`select ${ sql.json({ a: 1, b: 'hello' }) } as x`)[0].x
  return [true, x.a === 1 && x.b === 'hello']
})

t('Empty array', async() =>
  [true, Array.isArray((await sql`select ${ sql.array([]) }::int[] as x`)[0].x)]
)

t('Array of Integer', async() =>
  ['3', (await sql`select ${ sql.array([1, 2, 3]) } as x`)[0].x[2]]
)

t('Array of String', async() =>
  ['c', (await sql`select ${ sql.array(['a', 'b', 'c']) } as x`)[0].x[2]]
)

t('Array of Date', async() => {
  const now = new Date()
  return [now.getTime(), (await sql`select ${ sql.array([now, now, now]) } as x`)[0].x[2].getTime()]
})

t('Nested array n2', async() =>
  ['4', (await sql`select ${ sql.array([[1, 2], [3, 4]]) } as x`)[0].x[1][1]]
)

t('Nested array n3', async() =>
  ['6', (await sql`select ${ sql.array([[[1, 2]], [[3, 4]], [[5, 6]]]) } as x`)[0].x[2][0][1]]
)

t('Escape in arrays', async() =>
  ['Hello "you",c:\\windows', (await sql`select ${ sql.array(['Hello "you"', 'c:\\windows']) } as x`)[0].x.join(',')]
)

t('Escapes', async() => {
  return ['hej"hej', Object.keys((await sql`select 1 as ${ sql('hej"hej') }`)[0])[0]]
})

t('null for int', async() => {
  await sql`create table test (x int)`
  return [1, (await sql`insert into test values(${ null })`).count, await sql`drop table test`]
})

t('Transaction throws', async() => {
  await sql`create table test (a int)`
  return ['22P02', await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(x => x.code), await sql`drop table test`]
})

t('Transaction rolls back', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql`insert into test values('hej')`
  }).catch(() => { /* ignore */ })
  return [0, (await sql`select a from test`).count, await sql`drop table test`]
})

t('Transaction throws on uncaught savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch(() => 'fail')), await sql`drop table test`]
})

t('Transaction throws on uncaught named savepoint', async() => {
  await sql`create table test (a int)`

  return ['fail', (await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint('watpoint', async sql => {
      await sql`insert into test values(2)`
      throw new Error('fail')
    })
  }).catch(() => 'fail')), await sql`drop table test`]
})

t('Transaction succeeds on caught savepoint', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => { /* ignore */ })
    await sql`insert into test values(3)`
  })

  return ['2', (await sql`select count(1) from test`)[0].count, await sql`drop table test`]
})

t('Savepoint returns Result', async() => {
  let result
  await sql.begin(async sql => {
    result = await sql.savepoint(sql =>
      sql`select 1 as x`
    )
  })

  return [1, result[0].x]
})

t('Parallel transactions', async() => {
  await sql`create table test (a int)`
  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Transactions array', async() => {
  await sql`create table test (a int)`

  return ['11', (await sql.begin(sql => [
    sql`select 1`.then(x => x),
    sql`select 1`
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Transaction waits', async() => {
  await sql`create table test (a int)`
  await sql.begin(async sql => {
    await sql`insert into test values(1)`
    await sql.savepoint(async sql => {
      await sql`insert into test values(2)`
      throw new Error('please rollback')
    }).catch(() => { /* ignore */ })
    await sql`insert into test values(3)`
  })

  return ['11', (await Promise.all([
    sql.begin(sql => sql`select 1`),
    sql.begin(sql => sql`select 1`)
  ])).map(x => x.count).join(''), await sql`drop table test`]
})

t('Helpers in Transaction', async() => {
  return ['1', (await sql.begin(async sql =>
    await sql`select ${ sql({ x: 1 }) }`
  ))[0].x]
})

t('Undefined values throws', async() => {
  let error

  await sql`
    select ${ undefined } as x
  `.catch(x => error = x.code)

  return ['UNDEFINED_VALUE', error]
})

t('Null sets to null', async() =>
  [null, (await sql`select ${ null } as x`)[0].x]
)

t('Throw syntax error', async() =>
  ['42601', (await sql`wat 1`.catch(x => x)).code]
)

t('Connect using uri', async() =>
  [true, await new Promise((resolve, reject) => {
    const sql = postgres('postgres://' + login.user + ':' + (login.pass || '') + '@localhost:5432/' + options.db, {
      idle_timeout: options.idle_timeout
    })
    sql`select 1`.then(() => resolve(true), reject)
  })]
)

t('Fail with proper error on no host', async() =>
  ['ECONNREFUSED', (await new Promise((resolve, reject) => {
    const sql = postgres('postgres://localhost:33333/' + options.db, {
      idle_timeout: options.idle_timeout
    })
    sql`select 1`.then(reject, resolve)
  })).code]
)

t('Connect using SSL', async() =>
  [true, (await new Promise((resolve, reject) => {
    postgres({
      ssl: { rejectUnauthorized: false },
      idle_timeout: options.idle_timeout
    })`select 1`.then(() => resolve(true), reject)
  }))]
)

t('Login without password', async() => {
  return [true, (await postgres({ ...options, ...login })`select true as x`)[0].x]
})

t('Login using cleartext', async() => {
  return [true, (await postgres({ ...options, ...login_clear })`select true as x`)[0].x]
})

t('Login using MD5', async() => {
  return [true, (await postgres({ ...options, ...login_md5 })`select true as x`)[0].x]
})

t('Login using scram-sha-256', async() => {
  return [true, (await postgres({ ...options, ...login_scram })`select true as x`)[0].x]
})

t('Support dynamic password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => 'postgres_js_test_scram'
  })`select true as x`)[0].x]
})

t('Support dynamic async password function', async() => {
  return [true, (await postgres({
    ...options,
    ...login_scram,
    pass: () => Promise.resolve('postgres_js_test_scram')
  })`select true as x`)[0].x]
})

t('Point type', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point)`
  await sql`insert into test (x) values (${ sql.types.point([10, 20]) })`
  return [20, (await sql`select x from test`)[0].x[1], await sql`drop table test`]
})

t('Point type array', async() => {
  const sql = postgres({
    ...options,
    types: {
      point: {
        to: 600,
        from: [600],
        serialize: ([x, y]) => '(' + x + ',' + y + ')',
        parse: (x) => x.slice(1, -1).split(',').map(x => +x)
      }
    }
  })

  await sql`create table test (x point[])`
  await sql`insert into test (x) values (${ sql.array([sql.types.point([10, 20]), sql.types.point([20, 30])]) })`
  return [30, (await sql`select x from test`)[0].x[1][1], await sql`drop table test`]
})

t('sql file', async() =>
  [1, (await sql.file(path.join(__dirname, 'select.sql')))[0].x]
)

t('sql file can stream', async() => {
  let result
  await sql
    .file(path.join(__dirname, 'select.sql'), { cache: false })
    .stream(({ x }) => result = x)

  return [1, result]
})

t('sql file throws', async() =>
  ['ENOENT', (await sql.file('./selectomondo.sql').catch(x => x.code))]
)

t('sql file cached', async() => {
  await sql.file(path.join(__dirname, 'select.sql'))
  await delay(20)

  return [1, (await sql.file(path.join(__dirname, 'select.sql')))[0].x]
})

t('Parameters in file', async() => {
  const result = await sql.file(
    path.join(__dirname, 'select-param.sql'),
    ['hello']
  )
  return ['hello', result[0].x]
})

t('Connection ended promise', async() => {
  const sql = postgres(options)

  await sql.end()

  return [undefined, await sql.end()]
})

t('Connection ended timeout', async() => {
  const sql = postgres(options)

  await sql.end({ timeout: 10 })

  return [undefined, await sql.end()]
})

t('Connection ended error', async() => {
  const sql = postgres(options)
  sql.end()
  return ['CONNECTION_ENDED', (await sql``.catch(x => x.code))]
})

t('Connection end does not cancel query', async() => {
  const sql = postgres(options)

  const promise = sql`select 1 as x`
  sql.end()

  return [1, (await promise)[0].x]
})

t('Connection destroyed', async() => {
  const sql = postgres(options)
  setTimeout(() => sql.end({ timeout: 0 }), 0)
  return ['CONNECTION_DESTROYED', await sql``.catch(x => x.code)]
})

t('Connection destroyed with query before', async() => {
  const sql = postgres(options)
      , error = sql`select pg_sleep(0.2)`.catch(err => err.code)

  sql.end({ timeout: 0 })
  return ['CONNECTION_DESTROYED', await error]
})

t('Message not supported', async() => {
  await sql`create table test (x int)`
  return ['MESSAGE_NOT_SUPPORTED', await sql`copy test to stdout`.catch(x => x.code), await sql`drop table test`]
})

t('transform column', async() => {
  const sql = postgres({
    ...options,
    transform: { column: x => x.split('').reverse().join('') }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['dlrow_olleh', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toPascal', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toPascal }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['HelloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toCamel', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toCamel }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['helloWorld', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('column toKebab', async() => {
  const sql = postgres({
    ...options,
    transform: { column: postgres.toKebab }
  })

  await sql`create table test (hello_world int)`
  await sql`insert into test values (1)`
  return ['hello-world', Object.keys((await sql`select * from test`)[0])[0], await sql`drop table test`]
})

t('unsafe', async() => {
  await sql`create table test (x int)`
  return [1, (await sql.unsafe('insert into test values ($1) returning *', [1]))[0].x, await sql`drop table test`]
})

t('unsafe simple', async() => {
  return [1, (await sql.unsafe('select 1 as x'))[0].x]
})

t('listen and notify', async() => {
  const sql = postgres(options)
      , channel = 'hello'

  return ['world', await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
    .then(sql.end)
  )]
})

t('double listen', async() => {
  const sql = postgres(options)
      , channel = 'hello'

  let count = 0

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
  ).then(() => count++)

  // for coverage
  sql.listen('weee', () => { /* noop */ }).then(sql.end)

  return [2, count]
})

t('listen and notify with weird name', async() => {
  const sql = postgres(options)
      , channel = 'wat-;ø§'

  return ['world', await new Promise((resolve, reject) =>
    sql.listen(channel, resolve)
    .then(() => sql.notify(channel, 'world'))
    .catch(reject)
    .then(sql.end)
  )]
})

t('listen reconnects', async() => {
  const listener = postgres(options)
      , xs = []

  const { state: { pid } } = await listener.listen('test', x => xs.push(x))
  await sql.notify('test', 'a')
  await sql`select pg_terminate_backend(${ pid }::int)`
  await delay(50)
  await sql.notify('test', 'b')
  await delay(50)
  listener.end()

  return ['ab', xs.join('')]
})

t('responds with server parameters (application_name)', async() =>
  ['postgres.js', await new Promise((resolve, reject) => postgres({
    ...options,
    onparameter: (k, v) => k === 'application_name' && resolve(v)
  })`select 1`.catch(reject))]
)

t('has server parameters', async() => {
  return ['postgres.js', (await sql`select 1`.then(() => sql.parameters.application_name))]
})

t('big query body', async() => {
  await sql`create table test (x int)`
  return [1000, (await sql`insert into test ${
    sql([...Array(1000).keys()].map(x => ({ x })))
  }`).count, await sql`drop table test`]
})

t('Throws if more than 65534 parameters', async() => {
  await sql`create table test (x int)`
  return ['MAX_PARAMETERS_EXCEEDED', (await sql`insert into test ${
    sql([...Array(65535).keys()].map(x => ({ x })))
  }`.catch(e => e.code)), await sql`drop table test`]
})

t('let postgres do implicit cast of unknown types', async() => {
  await sql`create table test (x timestamp with time zone)`
  const [{ x }] = await sql`insert into test values (${ new Date().toISOString() }) returning *`
  return [true, x instanceof Date, await sql`drop table test`]
})

t('only allows one statement', async() =>
  ['42601', await sql`select 1; select 2`.catch(e => e.code)]
)

t('await sql() throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().then throws not tagged error', async() => {
  let error
  try {
    sql('select 1').then(() => { /* noop */ })
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().catch throws not tagged error', async() => {
  let error
  try {
    await sql('select 1')
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('sql().finally throws not tagged error', async() => {
  let error
  try {
    sql('select 1').finally(() => { /* noop */ })
  } catch (e) {
    error = e.code
  }
  return ['NOT_TAGGED_CALL', error]
})

t('dynamic column name', async() => {
  return ['!not_valid', Object.keys((await sql`select 1 as ${ sql('!not_valid') }`)[0])[0]]
})

t('dynamic select as', async() => {
  return ['2', (await sql`select ${ sql({ a: 1, b: 2 }) }`)[0].b]
})

t('dynamic select as pluck', async() => {
  return [undefined, (await sql`select ${ sql({ a: 1, b: 2 }, 'a') }`)[0].b]
})

t('dynamic insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return ['the answer', (await sql`insert into test ${ sql(x) } returning *`)[0].b, await sql`drop table test`]
})

t('dynamic insert pluck', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [null, (await sql`insert into test ${ sql(x, 'a') } returning *`)[0].b, await sql`drop table test`]
})

t('array insert', async() => {
  await sql`create table test (a int, b int)`
  return [2, (await sql`insert into test (a, b) values (${ [1, 2] }) returning *`)[0].b, await sql`drop table test`]
})

t('parameters in()', async() => {
  return [2, (await sql`
    with rows as (
      select * from (values (1), (2), (3), (4)) as x(a)
    )
    select * from rows where a in (${ [3, 4] })
  `).count]
})

t('dynamic multi row insert', async() => {
  await sql`create table test (a int, b text)`
  const x = { a: 42, b: 'the answer' }

  return [
    'the answer',
    (await sql`insert into test ${ sql([x, x]) } returning *`)[1].b, await sql`drop table test`
  ]
})

t('dynamic update', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return [
    'the answer',
    (await sql`update test set ${ sql({ a: 42, b: 'the answer' }) } returning *`)[0].b, await sql`drop table test`
  ]
})

t('dynamic update pluck', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (17, 'wrong')`

  return [
    'wrong',
    (await sql`update test set ${ sql({ a: 42, b: 'the answer' }, 'a') } returning *`)[0].b, await sql`drop table test`
  ]
})

t('dynamic select array', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql(['a', 'b']) } from test`)[0].b, await sql`drop table test`]
})

t('dynamic select args', async() => {
  await sql`create table test (a int, b text)`
  await sql`insert into test (a, b) values (42, 'yay')`
  return ['yay', (await sql`select ${ sql('a', 'b') } from test`)[0].b, await sql`drop table test`]
})

t('connection parameters', async() => {
  const sql = postgres({
    ...options,
    connection: {
      'some.var': 'yay'
    }
  })

  return ['yay', (await sql`select current_setting('some.var') as x`)[0].x]
})

t('Multiple queries', async() => {
  const sql = postgres(options)

  return [4, (await Promise.all([
    sql`select 1`,
    sql`select 2`,
    sql`select 3`,
    sql`select 4`
  ])).length]
})

t('Multiple statements', async() =>
  [2, await sql.unsafe(`
    select 1 as x;
    select 2 as a;
  `).then(([, [x]]) => x.a)]
)

t('throws correct error when authentication fails', async() => {
  const sql = postgres({
    ...options,
    ...login_md5,
    pass: 'wrong'
  })
  return ['28P01', await sql`select 1`.catch(e => e.code)]
})

t('notice works', async() => {
  let notice
  const log = console.log
  console.log = function(x) {
    notice = x
  }

  const sql = postgres(options)

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  console.log = log

  return ['NOTICE', notice.severity]
})

t('notice hook works', async() => {
  let notice
  const sql = postgres({
    ...options,
    onnotice: x => notice = x
  })

  await sql`create table if not exists users()`
  await sql`create table if not exists users()`

  return ['NOTICE', notice.severity]
})

t('bytea serializes and parses', async() => {
  const buf = Buffer.from('wat')

  await sql`create table test (x bytea)`
  await sql`insert into test values (${ buf })`

  return [0, Buffer.compare(buf, (await sql`select x from test`)[0].x)]
})

t('Stream works', async() => {
  let result
  await sql`select 1 as x`.stream(({ x }) => result = x)
  return [1, result]
})

t('Stream returns empty array', async() => {
  return [0, (await sql`select 1 as x`.stream(() => { /* noop */ })).length]
})

t('Cursor works', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async(x) => {
    order.push(x.x + 'a')
    await delay(100)
    order.push(x.x + 'b')
  })
  return ['1a1b2a2b', order.join('')]
})

t('Cursor custom n works', async() => {
  const order = []
  await sql`select * from generate_series(1,20)`.cursor(10, async(x) => {
    order.push(x.length)
  })
  return ['10,10', order.join(',')]
})

t('Cursor cancel works', async() => {
  let result
  await sql`select * from generate_series(1,10) as x`.cursor(async({ x }) => {
    result = x
    return sql.END
  })
  return [1, result]
})

t('Cursor throw works', async() => {
  const order = []
  await sql`select 1 as x union select 2 as x`.cursor(async(x) => {
    order.push(x.x + 'a')
    await delay(100)
    throw new Error('watty')
  }).catch(() => order.push('err'))
  return ['1aerr', order.join('')]
})

// With max: 1, a plain query issued while a transaction is open must wait for the commit. If the
// pool held the transaction's connection (or held it twice), the query would run inside it.
async function queryLeaksIntoTransaction(sql) {
  let leaked
  await sql.begin(async tx => {
    await tx`set local application_name = 'in_tx'`
    leaked = sql`select current_setting('application_name') as x`
    await delay(20)
  })
  return (await leaked)[0].x === 'in_tx'
}

t('Cursor inside begin() completes and the connection is returned once', async() => {
  const sql = postgres({ ...options, max: 1 })
  const sizes = []
  await sql.begin(async tx => {
    await tx`select * from generate_series(1, 5)`.cursor(2, rows => { sizes.push(rows.length) })
  })
  const leaks = await queryLeaksIntoTransaction(sql)
  await sql.end()
  return ['2,2,1,false', sizes.concat(leaks).join()]
})

t('Cursor END inside begin() returns the connection once', async() => {
  const sql = postgres({ ...options, max: 1 })
  let calls = 0
  await sql.begin(async tx => {
    await tx`select * from generate_series(1, 10)`.cursor(2, () => (calls++, tx.END))
  })
  const leaks = await queryLeaksIntoTransaction(sql)
  await sql.end()
  return ['1,false', [calls, leaks].join()]
})

t('Cursor END outside a transaction returns the connection once and runs the query queued behind it', async() => {
  const sql = postgres({ ...options, max: 1 })
  let calls = 0
    , queued
  await sql`select * from generate_series(1, 10)`.cursor(2, () => {
    calls++
    // the cursor holds the only connection: this waits in the pool queue until the cursor ends
    queued = sql`select 1 as x`
    return sql.END
  })
  const [{ x }] = await queued
  const leaks = await queryLeaksIntoTransaction(sql)
  await sql.end()
  return ['1,1,false', [calls, x, leaks].join()]
})

t('Cursor registered twice returns its connection once', async() => {
  const sql = postgres({ ...options, max: 1 })
  const query = sql`select * from generate_series(1, 2) as x`
  let competing
  const fn = async() => {
    // the cursor holds the only connection: this transaction waits for it in the pool queue and must
    // own it alone once it gets it, however many .cursor() finalizers release it
    competing = competing || queryLeaksIntoTransaction(sql)
    await delay(5)
  }
  await Promise.all([query.cursor(fn), query.cursor(fn)])
  const leaks = await competing
  await sql.end()
  return ['false', String(leaks)]
})

t('Cursor inside begin() does not hand the connection to a competing query', async() => {
  const sql = postgres({ ...options, max: 1 })
  const order = []
  let competing
  await sql.begin(async tx => {
    await tx`set local application_name = 'in_tx'`
    await tx`select * from generate_series(1, 4)`.cursor(2, () => { /* noop */ })
    competing = sql`select current_setting('application_name') as x`
      .then(([{ x }]) => (order.push('competing'), x))
    await delay(20)
    order.push('commit')
  })
  const x = await competing
  await sql.end()
  return ['commit,competing,postgres.js', order.concat(x).join()]
})

t('Competing query waits for a cursor outside a transaction and then runs', async() => {
  const sql = postgres({ ...options, max: 1 })
  const order = []
  let competing
  await sql`select * from generate_series(1, 4)`.cursor(2, async() => {
    competing = competing || sql`select 1`.then(() => order.push('competing'))
    await delay(10)
    order.push('batch')
  })
  await competing
  await sql.end()
  return ['batch,batch,competing', order.join()]
})

t('Cursor statement timeout inside begin() rejects with 57014 and the connection is reusable', async() => {
  const sql = postgres({ ...options, max: 1 })
  let batches = 0
  const started = Date.now()
  const err = await sql.begin(async tx => {
    await tx`set local statement_timeout = 100`
    await tx`select pg_sleep(0.01) from generate_series(1, 100)`.cursor(5, () => { batches++ })
  }).catch(e => e)
  const elapsed = Date.now() - started
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['57014,true,true,1', [err.code, batches > 0, elapsed < 400, x].join()]
})

t('Cursor statement timeout outside a transaction rejects with 57014 and the connection is reusable', async() => {
  const sql = postgres({ ...options, max: 1, connection: { statement_timeout: 100 } })
  const err = await sql`select pg_sleep(0.01) from generate_series(1, 100)`.cursor(5, () => { /* noop */ })
    .catch(e => e)
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['57014,1', [err.code, x].join()]
})

t('Cursor error before the first batch rejects', async() => {
  const sql = postgres({ ...options, max: 1 })
  const err = await sql`select 1/0 as x from generate_series(1, 4)`.cursor(2, () => { /* noop */ })
    .catch(e => e)
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['22012,1', [err.code, x].join()]
})

t('Cursor callback throw closes the portal and the transaction stays usable', async() => {
  const sql = postgres({ ...options, max: 1 })
  let calls = 0
  const result = await sql.begin(async tx => {
    const err = await tx`select * from generate_series(1, 10)`.cursor(2, () => {
      calls++
      throw new Error('boom')
    }).catch(e => e)
    const [{ x }] = await tx`select 42 as x`
    return err.message + x
  })
  const leaks = await queryLeaksIntoTransaction(sql)
  await sql.end()
  return ['boom42,1,false', [result, calls, leaks].join()]
})

// A real-server regression guard for the last-batch path (it passes without the settlement barrier
// too); that the rejection waits for ReadyForQuery is pinned by the fake-server test further down.
t('Cursor callback throw on the last batch rejects with the thrown error', async() => {
  const sql = postgres({ ...options, max: 1 })
  const err = await sql`select * from generate_series(1, 3)`.cursor(5, () => {
    throw new Error('last')
  }).catch(e => e)
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['last,1', [err.message, x].join()]
})

t('Cursor callback rejection with any value rejects with exactly that value', async() => {
  const sql = postgres({ ...options, max: 1 })
  const values = [undefined, null, false, 0, '', 'boom', Object.freeze(new Error('frozen'))]
  const results = []
  for (const value of values) {
    results.push(await sql`select * from generate_series(1, 3)`.cursor(() => { throw value }).then(
      () => 'resolved',
      e => e === value ? 'same' : 'other'
    ))
  }
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['same,same,same,same,same,same,same,1', results.concat(x).join()]
})

t('Cursor with an invalid batch size rejects at once and sends nothing', async() => {
  const sent = []
  const sql = postgres({ ...options, max: 1, debug: (id, str) => sent.push(str) })
  // the transaction holds the only connection: a query that had to be sent would wait for it forever
  const codes = await sql.begin(async() => {
    const codes = []
    for (const rows of [0, -1, 1.5, 2 ** 31, '2'])
      codes.push(await sql`select 'invalid' as x`.cursor(rows, () => { /* noop */ }).catch(e => e.code))
    return codes
  })
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return [
    'INVALID_CURSOR_ROWS,INVALID_CURSOR_ROWS,INVALID_CURSOR_ROWS,INVALID_CURSOR_ROWS,INVALID_CURSOR_ROWS,1,false',
    codes.concat(x, sent.some(x => x.includes('invalid'))).join()
  ]
})

t('Cursor queued for a busy pool runs alone on its connection', async() => {
  const sql = postgres({ ...options, max: 1 })
  const order = []
  let queued
  await sql`select * from generate_series(1, 2) as x`.cursor(async({ x }) => {
    // the only connection is held by this cursor: both wait in the pool queue
    queued = queued || Promise.all([
      sql`select * from generate_series(1, 3) as x`.cursor(async({ x }) => (await delay(5), order.push('b' + x))),
      sql`select 'q' as x`.then(([{ x }]) => order.push(x))
    ])
    await delay(5)
    order.push('a' + x)
  })
  await queued
  await sql.end()
  return ['a1,a2,b1,b2,b3,q', order.join()]
})

t('Uncached sql.file() cursor holds its connection until it ends', async() => {
  const sql = postgres({ ...options, max: 1 })
  const order = []
  let competing
  await sql.file(path.join(__dirname, 'select-param.sql'), ['1']).cursor(async() => {
    competing = sql`select 2 as y`.then(([{ y }]) => (order.push('competing'), y))
    await delay(10)
    order.push('batch')
  })
  const y = await competing
  await sql.end()
  return ['batch,competing,2', order.concat(y).join()]
})

t('Query and transaction waiting for a cursor\'s connection are rejected once sql.end() has started', async() => {
  const sql = postgres({ ...options, max: 1 })
  let waiting
    , ending
  await sql`select * from generate_series(1, 2)`.cursor(async() => {
    if (!waiting) {
      waiting = Promise.all([
        sql`select 1`.catch(e => e.code),
        sql.begin(async tx => { await tx`select 1` }).catch(e => e.code)
      ])
      ending = sql.end()
    }
    await delay(5)
  })
  return ['CONNECTION_ENDED,CONNECTION_ENDED', (await waiting).join(), await ending]
})

t('Uncached sql.file() cursor with an invalid batch size rejects at once inside a transaction on max: 1', async() => {
  const sent = []
  const sql = postgres({ ...options, max: 1, debug: (id, str) => sent.push(str) })
  // the transaction holds the only connection: waiting for one to deliver the rejection would wait forever
  const codes = await sql.begin(() => Promise.all([
    sql.file(path.join(__dirname, 'select.sql'), { cache: false }).cursor(0, () => { /* noop */ }),
    // rejected at the .cursor() call, before the file is even read
    sql.file(path.join(__dirname, 'missing.sql'), { cache: false }).cursor(0, () => { /* noop */ })
  ].map(x => x.catch(e => e.code))))
  const [{ y }] = await sql`select 2 as y`
  await sql.end()
  return ['INVALID_CURSOR_ROWS,INVALID_CURSOR_ROWS,2,false', [...codes, y, sent.includes('select 1 as x')].join()]
})

t('Queued queries failing to parse are rejected, a cancelled one is never parsed, the ones behind run', async() => {
  // every value passed through sql.types.probe() is recorded when its query is parsed
  const serialized = []
  const sql = postgres({ ...options, max: 1, types: { probe: { to: 1043, from: [], serialize: x => {
    serialized.push(x)
    if (x === 'throw')
      throw new Error('serializer')
    return x
  } } } })
  const unhandled = []
  const onunhandled = e => unhandled.push(e && e.code)
  process.on('unhandledRejection', onunhandled)
  try {
    let queued
    const code = await sql.begin(async() => {
      // the transaction holds the only connection: all of these wait in the pool queue and are parsed
      // only when they leave it, so the undefined value and the throwing serializer fail only then
      const code = await sql`select ${ sql.types.probe('cancelled') }`.cursor(0, () => { /* noop */ })
        .catch(e => e.code)
      queued = Promise.all([
        // a valid cursor holds its connection before it is parsed: its parse failure must return it
        sql`select ${ sql.types.probe('throw') } as x`.cursor(() => { /* noop */ }).catch(e => e.message),
        sql`select ${ undefined } as x`.catch(e => e.code),
        sql`select ${ sql.types.probe('ok') }::text as x`.then(([{ x }]) => x)
      ])
      return code
    })
    const results = await queued
    await delay(10)
    const leaks = await queryLeaksIntoTransaction(sql)
    await sql.end()
    return [
      'INVALID_CURSOR_ROWS,serializer,UNDEFINED_VALUE,ok,throw|ok,,false',
      [code, ...results, serialized.join('|'), unhandled.join(), leaks].join()
    ]
  } finally {
    process.removeListener('unhandledRejection', onunhandled)
  }
})

t('Queued cursor whose serializer starts a transaction does not run inside it', async() => {
  let begun
  const sql = postgres({ ...options, max: 1, types: { probe: { to: 1043, from: [], serialize: fn => fn() } } })
  let cursorXid
    , queued
  await sql`select 1`.cursor(async() => {
    // the cursor holds the only connection: this one waits in the pool queue and is parsed (its
    // serializer starting a transaction) only when it leaves it, onto the connection given to it
    queued = sql`select txid_current()::text as id, ${ sql.types.probe(() => {
      // the delay lets an outside cursor sent into this transaction finish before it is used here
      begun = sql.begin(tx => delay(20).then(() => tx`select txid_current()::text as id`))
      return 'probe'
    }) }::text as x`.cursor(({ id }) => { cursorXid = id })
    await delay(5)
  })
  await queued
  const [{ id: txXid }] = await begun
  await sql.end()
  return ['false', String(cursorXid === txXid)]
})

t('Cursor server error inside a savepoint rolls back to it and the transaction continues', async() => {
  const sql = postgres({ ...options, max: 1 })
  const result = await sql.begin(async tx => {
    await tx`set local application_name = 'in_tx'`
    // division by zero on the third row, after two batches went through the asynchronous callback
    const code = await tx.savepoint(sp =>
      sp`select 10 / (3 - x) as x from generate_series(1, 5) as x`.cursor(async() => { await delay(5) })
    ).catch(e => e.code)
    const [{ x }] = await tx`select current_setting('application_name') as x`
    return [code, x].join()
  })
  const leaks = await queryLeaksIntoTransaction(sql)
  await sql.end()
  return ['22012,in_tx,false', [result, leaks].join()]
})

t('Socket close while a cursor callback is pending writes nothing afterwards', async() => {
  let socket
  const late = []
  const sql = postgres({
    ...options,
    max: 1,
    onsocket: x => {
      if (socket)
        return
      socket = x
      const write = x.write
      x.write = function(...args) {
        x.destroyed && late.push(args[0])
        return write.apply(this, args)
      }
    }
  })
  const err = await sql`select * from generate_series(1, 10)`.cursor(2, async() => {
    socket.destroy()
    await delay(20)
  }).catch(e => e)
  await delay(30)
  const [{ x }] = await sql`select 1 as x`
  await sql.end()
  return ['CONNECTION_CLOSED,0,1', [err.code, late.length, x].join()]
})

t('Cursor callback rejection settles only after ReadyForQuery, on a suspended and on the last batch', async() => {
  const server = await fakeServer()
  const sql = postgres({ host: '127.0.0.1', port: server.port, max: 1 })
  try {
    const results = []
    // 1 row per batch: the callback throws after PortalSuspended; 5 rows: on the final CommandComplete
    for (const rows of [1, 5]) {
      let settled = false
      server.hold = true
      const cursor = sql`select x`.cursor(rows, () => { throw new Error('boom' + rows) })
        .catch(e => (settled = true, e.message))
      // the cursor's Close+Sync arrived and its ReadyForQuery is withheld
      await server.when(() => server.held.length)
      results.push(settled, server.last().received.slice(-2).join(''))
      server.release()
      results.push(await cursor)
    }
    return ['false,CS,boom1,false,CS,boom5', results.join()]
  } finally {
    sql.end({ timeout: 0 })
    server.close()
  }
})

t('Cursor server error while the callback is pending sends one Sync and the callback writes nothing', async() => {
  const server = await fakeServer()
  const notices = []
  const sql = postgres({ host: '127.0.0.1', port: server.port, max: 1, onnotice: x => notices.push(x.message) })
  try {
    const results = []
    // the callback continues either between the ErrorResponse and the withheld ReadyForQuery, with a
    // second ErrorResponse arriving in between too, or once the cursor has settled
    for (const early of [true, false]) {
      for (const outcome of ['fulfil', 'reject', 'end']) {
        let called
          , finish
          , settled = false
        const pending = new Promise(r => called = r)
        const gate = new Promise(r => finish = r)
        const cursor = sql`select x`.cursor(async() => {
          called()
          await gate
          if (outcome === 'reject')
            throw new Error('late')
          return outcome === 'end' ? sql.END : undefined
        }).catch(e => (settled = true, e.code))
        await pending
        const connection = server.last()
            , mark = connection.received.length
        server.hold = early
        // ErrorResponse, then a NoticeResponse and a NotificationResponse; ReadyForQuery only after Sync
        server.error()
        if (early) {
          // the cursor's Sync arrived and its ReadyForQuery is withheld
          await server.when(() => server.held.length)
          finish()
          await delay(5)
          server.errorAgain()
          await delay(5)
          results.push(settled, connection.received.slice(mark).join(''))
          server.release()
        }
        results.push(await cursor)
        if (!early) {
          finish()
          await delay(5)
        }
        const rows = await sql`select x as ${ sql(outcome + early) }`
        // nothing between the cursor's single Sync and the next query's messages
        results.push(/^SP?BDEHS$/.test(connection.received.slice(mark).join('')), rows.length)
      }
    }
    return [
      'false,S,57014,true,3,false,S,57014,true,3,false,S,57014,true,3,57014,true,3,57014,true,3,57014,true,3,9',
      results.concat(notices.filter(x => x === 'fake notice').length).join()
    ]
  } finally {
    sql.end({ timeout: 0 })
    server.close()
  }
})

t('Cursor END or callback rejection racing a server error reuses the queued Close+Sync', async() => {
  const server = await fakeServer()
  const sql = postgres({ host: '127.0.0.1', port: server.port, max: 1, onnotice: () => { /* noop */ } })
  try {
    const results = []
    for (const outcome of ['end', 'reject']) {
      // the server reports an error (say, a statement timeout) as the cursor's Close+Sync is on its way
      server.errorOnClose = true
      results.push(await sql`select x`.cursor(() => {
        if (outcome === 'reject')
          throw new Error('callback')
        return sql.END
      }).catch(e => e.code || e.message))
      server.errorOnClose = false
      // a second Sync would yield a second ReadyForQuery and resolve the next query early, empty
      const rows = await sql`select x as ${ sql(outcome) }`
      results.push(/CSP?BDEHS$/.test(server.last().received.join('')), rows.length)
    }
    // an already recorded callback rejection keeps precedence over the server error
    return ['57014,true,3,callback,true,3', results.join()]
  } finally {
    sql.end({ timeout: 0 })
    server.close()
  }
})

t('Socket close while a cursor callback is pending writes nothing into the replacement socket', async() => {
  const server = await fakeServer()
  const sql = postgres({ host: '127.0.0.1', port: server.port, max: 1 })
  try {
    let called
      , finish
    const pending = new Promise(r => called = r)
    const gate = new Promise(r => finish = r)
    const cursor = sql`select x`.cursor(async() => (called(), await gate)).catch(e => e.code)
    await pending
    server.drop()
    const code = await cursor
    // a new socket replaces the closed one, then the old callback continues
    await sql`select x as first`
    finish()
    await delay(5)
    const rows = await sql`select x as second`
    return [
      'CONNECTION_CLOSED,2,PBDEHSPBDEHS,3',
      [code, server.connections.length, server.last().received.join(''), rows.length].join()
    ]
  } finally {
    sql.end({ timeout: 0 })
    server.close()
  }
})

t('Cursor registered again once it was sent is rejected on its own and the running cursor completes', async() => {
  const server = await fakeServer()
  const sql = postgres({ host: '127.0.0.1', port: server.port, max: 1 })
  try {
    let called
      , finish
    const pending = new Promise(r => called = r)
    const gate = new Promise(r => finish = r)
    const rows = []
    const query = sql`select x`
    const cursor = query.cursor(async({ x }) => (rows.push(x), called(), await gate))
      .then(() => 'done', e => e.code)
    await pending
    // the cursor holds the only connection: this waits in the pool queue until the cursor ends
    const following = sql`select x as following`
    // too late to change: neither may settle the running cursor, release its connection or replace its callback
    const late = await Promise.all([
      query.cursor(0, () => { /* noop */ }),
      query.cursor(2, () => rows.push('late'))
    ].map(x => x.catch(e => e.code)))
    await delay(5)
    finish()
    const outcome = await cursor
    const result = await following
    return [
      'CURSOR_AFTER_SEND,CURSOR_AFTER_SEND,done,1,2,3,3',
      late.concat(outcome, rows, result.length).join()
    ]
  } finally {
    sql.end({ timeout: 0 })
    server.close()
  }
})

t('Cursor registered on a pool-queued query once it was dispatched is rejected and the query runs plain', async() => {
  const sql = postgres({ ...options, max: 1 })
  let queued
  await sql`select 1 as x`.cursor(() => {
    // the cursor holds the only connection: this waits in the pool queue
    queued = queued || sql`select * from generate_series(1, 3) as x`
  })
  // the cursor's end dispatched the queued query to the connection, which writes it only on the next
  // tick: too late to turn it into a cursor that a competing begin() would then pipeline BEGIN behind
  const rows = []
  const late = queued.cursor(1, async({ x }) => (rows.push(x), await delay(5))).catch(e => e.code)
  const tx = sql.begin(async sql => (await sql`select 2 as y`)[0].y).catch(e => e.code)
  const result = await queued
  const outcome = [await late, await tx]
  const [{ z }] = await sql`select 3 as z`
  await sql.end()
  return [
    'CURSOR_AFTER_SEND,2,1,2,3,,3',
    outcome.concat(result.map(r => r.x), rows.join(), z).join()
  ]
})

// A fake server speaking just enough of the protocol to script a cursor at exact points: every query
// yields one int4 column `x` with the rows 1, 2, 3 (none for the array types lookup). Like PostgreSQL,
// after an ErrorResponse (`error()` while a cursor waits, or `errorOnClose` in place of CloseComplete)
// it skips every message up to the next Sync; `errorAgain()` just sends one more ErrorResponse. With
// `hold` set, the ReadyForQuery answering a query's Sync is withheld until `release()`. Each connection
// lists the message types it got in `received`; `when(fn)` resolves once fn() is true, checked after
// every message.
function fakeServer() {
  const msg = (type, ...parts) => {
    const body = Buffer.concat(parts.map(x => typeof x === 'string' ? Buffer.from(x) : x))
    const header = Buffer.alloc(5)
    header.write(type)
    header.writeInt32BE(body.length + 4, 1)
    return Buffer.concat([header, body])
  }
  const int = (bytes, x) => {
    const b = Buffer.alloc(bytes)
    bytes === 2 ? b.writeInt16BE(x) : b.writeInt32BE(x)
    return b
  }
  const ready = msg('Z', 'I')
  const column = msg('T', int(2, 1), 'x\u0000', int(4, 0), int(2, 0), int(4, 23), int(2, 4), int(4, -1), int(2, 0))
  const failure = Buffer.concat([
    msg('E', 'SERROR\u0000C57014\u0000Mcanceling statement due to statement timeout\u0000\u0000'),
    msg('N', 'SNOTICE\u0000C00000\u0000Mfake notice\u0000\u0000'),
    msg('A', int(4, 1), 'fake\u0000', 'payload\u0000')
  ])
  const waiters = []
  const fake = {
    connections: [],
    held: [],
    hold: false,
    errorOnClose: false,
    last: () => fake.connections[fake.connections.length - 1],
    error: () => fail(fake.last()),
    errorAgain: () => fake.last().socket.write(failure),
    drop: () => fake.last().socket.destroy(),
    release,
    when,
    close
  }

  const server = net.createServer(socket => {
    const connection = { socket, received: [], failed: false, lookup: false, rows: [] }
        , statements = {}
    let buffer = Buffer.alloc(0)
      , started = false

    fake.connections.push(connection)
    socket.on('error', () => { /* dropped on purpose */ })
    socket.on('data', x => {
      buffer = Buffer.concat([buffer, x])
      while (buffer.length >= (started ? 5 : 4)) {
        const length = buffer.readInt32BE(started ? 1 : 0) + (started ? 1 : 0)
        if (buffer.length < length)
          break
        started ? onmessage(String.fromCharCode(buffer[0]), buffer.slice(5, length)) : onstartup()
        buffer = buffer.slice(length)
      }
    })

    function onstartup() {
      started = true
      socket.write(Buffer.concat([msg('R', int(4, 0)), ready]))
    }

    function onmessage(type, body) {
      connection.received.push(type)
      if (!connection.failed || type === 'S') {
        const strings = body.toString().split('\u0000')
        type === 'P' && (statements[strings[0]] = strings[1], socket.write(msg('1')))
        type === 'B' && bind(statements[strings[1]])
        type === 'D' && socket.write(column)
        type === 'E' && execute(body.readInt32BE(body.indexOf(0) + 1))
        type === 'C' && (fake.errorOnClose ? fail(connection) : socket.write(msg('3')))
        type === 'S' && sync()
        type === 'X' && socket.end()
      }
      check()
    }

    function bind(statement) {
      connection.lookup = /pg_type/.test(statement)
      connection.rows = connection.lookup ? [] : ['1', '2', '3']
      socket.write(msg('2'))
    }

    function execute(max) {
      const batch = connection.rows.splice(0, max || connection.rows.length)
      batch.forEach(x => socket.write(msg('D', int(2, 1), int(4, x.length), x)))
      socket.write(connection.rows.length ? msg('s') : msg('C', 'SELECT ' + batch.length + '\u0000'))
    }

    function sync() {
      connection.failed = false
      fake.hold && !connection.lookup
        ? fake.held.push(() => socket.write(ready))
        : socket.write(ready)
    }
  })

  function fail(connection) {
    connection.failed = true
    connection.socket.write(failure)
  }

  function release() {
    fake.hold = false
    fake.held.splice(0).forEach(fn => fn())
  }

  function when(fn) {
    return new Promise(resolve => {
      const test = () => fn() ? (resolve(), true) : false
      test() || waiters.push(test)
    })
  }

  function check() {
    waiters.splice(0).forEach(test => test() || waiters.push(test))
  }

  function close() {
    release()
    fake.connections.forEach(x => x.socket.destroy())
    server.close()
  }

  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve(Object.assign(fake, { port: server.address().port }))
  ))
}

t('Transform row', async() => {
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  return [1, (await sql`select 'wat'`)[0]]
})

t('Transform row stream', async() => {
  let result
  const sql = postgres({
    ...options,
    transform: { row: () => 1 }
  })

  await sql`select 1`.stream(x => result = x)

  return [1, result]
})

t('Transform value', async() => {
  const sql = postgres({
    ...options,
    transform: { value: () => 1 }
  })

  return [1, (await sql`select 'wat' as x`)[0].x]
})

t('Unix socket', async() => {
  const sql = postgres({
    ...options,
    host: '/tmp'
  })

  return [1, (await sql`select 1 as x`)[0].x]
})

t('Big result', async() => {
  return [100000, (await sql`select * from generate_series(1, 100000)`).count]
})

t('Debug works', async() => {
  let result
  const sql = postgres({
    ...options,
    debug: (connection_id, str) => result = str
  })

  await sql`select 1`

  return ['select 1', result]
})

t('bigint is returned as String', async() => [
  'string',
  typeof (await sql`select 9223372036854777 as x`)[0].x
])

t('int is returned as Number', async() => [
  'number',
  typeof (await sql`select 123 as x`)[0].x
])

t('numeric is returned as string', async() => [
  'string',
  typeof (await sql`select 1.2 as x`)[0].x
])

t('Async stack trace', async() => {
  const sql = postgres({ ...options, debug: false })
  return [
    parseInt(new Error().stack.split('\n')[1].split(':')[1]) + 1,
    parseInt(await sql`select.sql`.catch(x => x.stack.split('\n').pop().split(':')[1]))
  ]
})

t('Debug has long async stack trace', async() => {
  const sql = postgres({ ...options, debug: true })

  return [
    'watyo',
    await yo().catch(x => x.stack.match(/wat|yo/g).join(''))
  ]

  function yo() {
    return wat()
  }

  function wat() {
    return sql`selec 1`
  }
})

t('Error contains query string', async() => [
  'selec 1',
  (await sql`selec 1`.catch(err => err.query))
])

t('Error contains query parameters', async() => [
  '1',
  (await sql`selec ${ 1 }`.catch(err => err.parameters[0].value))
])

t('Query string is not enumerable', async() => {
  const sql = postgres({ ...options, debug: false })
  return [
    -1,
    (await sql`selec 1`.catch(err => Object.keys(err).indexOf('query')))
  ]
})

t('Query and parameters are not enumerable if debug is not set', async() => {
  const sql = postgres({ ...options, debug: false })

  return [
    false,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') || err.propertyIsEnumerable('query')))
  ]
})

t('Query and parameters are enumerable if debug is set', async() => {
  const sql = postgres({ ...options, debug: true })

  return [
    true,
    (await sql`selec ${ 1 }`.catch(err => err.propertyIsEnumerable('parameters') && err.propertyIsEnumerable('query')))
  ]
})

t('connect_timeout works', async() => {
  const connect_timeout = 0.2
  const server = net.createServer()
  server.listen()
  const sql = postgres({ port: server.address().port, connect_timeout })
  const start = Date.now()
  let end
  await sql`select 1`.catch((e) => {
    if (e.code !== 'CONNECT_TIMEOUT')
      throw e
    end = Date.now()
  })
  server.close()
  return [connect_timeout, Math.floor((end - start) / 100) / 10]
})

t('connect_timeout throws proper error', async() => [
  'CONNECT_TIMEOUT',
  await postgres({
    ...options,
    ...login_scram,
    connect_timeout: 0.001
  })`select 1`.catch(e => e.code)
])

t('requests works after single connect_timeout', async() => {
  let first = true

  const sql = postgres({
    ...options,
    ...login_scram,
    connect_timeout: { valueOf() { return first ? (first = false, 0.001) : 1 } }
  })

  return [
    'CONNECT_TIMEOUT,,1',
    [
      await sql`select 1 as x`.catch(x => x.code),
      await new Promise(r => setTimeout(r, 10)),
      (await sql`select 1 as x`)[0].x
    ].join(',')
  ]
})

t('Postgres errors are of type PostgresError', async() =>
  [true, (await sql`bad keyword`.catch(e => e)) instanceof sql.PostgresError]
)

t('Result has columns spec', async() =>
  ['x', (await sql`select 1 as x`).columns[0].name]
)

t('Stream has result as second argument', async() => {
  let x
  await sql`select 1 as x`.stream((_, result) => x = result)
  return ['x', x.columns[0].name]
})

t('Result as arrays', async() => {
  const sql = postgres({
    ...options,
    transform: {
      row: x => Object.values(x)
    }
  })

  return ['1,2', (await sql`select 1 as a, 2 as b`)[0].join(',')]
})

t('Insert empty array', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester (ints) values (${ sql.array([]) }) returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})

t('Insert array in sql()', async() => {
  await sql`create table tester (ints int[])`
  return [
    Array.isArray((await sql`insert into tester ${ sql({ ints: sql.array([]) })} returning *`)[0].ints),
    true,
    await sql`drop table tester`
  ]
})

t('Automatically creates prepared statements', async() => {
  const sql = postgres({ ...options, no_prepare: false })
  const result = await sql`select * from pg_prepared_statements`
  return [result[0].statement, 'select * from pg_prepared_statements']
})

t('no_prepare: true disables prepared transactions', async() => {
  const sql = postgres({ ...options, no_prepare: true })
  const result = await sql`select * from pg_prepared_statements`
  return [0, result.count]
})

t('Catches connection config errors', async() => {
  const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  return [
    'wat',
    await sql`select 1`.catch((e) => e.message)
  ]
})

t('Catches connection config errors with end', async() => {
  const sql = postgres({ ...options, user: { toString: () => { throw new Error('wat') } }, database: 'prut' })

  return [
    'wat',
    await sql`select 1`.catch((e) => e.message),
    await sql.end()
  ]
})

t('Catches query format errors', async() => [
  'wat',
  await sql.unsafe({ toString: () => { throw new Error('wat') } }).catch((e) => e.message)
])
