// Vocabulary for fields and operators, never a second description keyed by rule ID.
const FIELDS = {
  'crm.completed': {
    name: 'отметка о завершении в CRM',
    yes: 'в CRM отмечено завершение',
    no: 'в CRM указано, что операция ещё не завершена',
    notYes: 'в CRM указано «не завершено» или статус завершения неизвестен',
  },
  'crm.managerApproved': {
    name: 'подтверждение руководителя в CRM',
    yes: 'в CRM есть подтверждение руководителя',
    no: 'в CRM указано, что подтверждения руководителя нет',
    notYes: 'подтверждение руководителя в CRM отсутствует или неизвестно',
  },
  'crm.documents': { name: 'статус документов в CRM' },
  'message.signal': { name: 'сведения в сообщении' },
  'crm.receivedAt': {
    name: 'время приёмки', genitive: 'времени приёмки', instrumental: 'временем приёмки',
    absent: 'время приёмки не указано', present: 'время приёмки указано',
    dated: 'приёмка датирована', eventGenitive: 'приёмки', eventInstrumental: 'приёмкой',
  },
  'message.occurredAt': {
    name: 'время сообщения', genitive: 'времени сообщения', instrumental: 'временем сообщения',
    absent: 'время сообщения не указано', present: 'время сообщения указано',
    dated: 'сообщение датировано', eventGenitive: 'сообщения', eventInstrumental: 'сообщением',
  },
  'sources.crm.updatedAt': {
    name: 'время обновления CRM', genitive: 'времени обновления CRM', instrumental: 'временем обновления CRM',
  },
  dueAt: {
    name: 'точный срок', genitive: 'точного срока', instrumental: 'точным сроком',
    absent: 'точный срок не указан', present: 'точный срок указан',
  },
  dueDate: {
    name: 'дата срока', genitive: 'даты срока', instrumental: 'датой срока',
    absent: 'дата срока не указана', present: 'дата срока указана',
  },
  asOf: {
    name: 'время расчёта', genitive: 'времени расчёта', instrumental: 'временем расчёта',
  },
};

const SIGNALS = {
  missing: 'недостаче', delay: 'задержке', received: 'получении',
  sent: 'отправке документов', aware: 'том, что руководитель в курсе',
};
const DOCUMENTS = {
  incomplete: 'комплект документов неполный',
  accepted: 'документы приняты',
  pending: 'документы ожидаются',
};
const isField = (value, path) => value?.op === 'field' && value.path === path;
const isDay = (value, path) => value?.op === 'day' && isField(value.value, path);

function operand(expression) {
  if (expression?.op === 'field') {
    const word = FIELDS[expression.path];
    if (!word) throw new Error('Missing field vocabulary: ' + expression.path);
    return { ...word, path: expression.path };
  }
  if (expression?.op === 'instant') return operand(expression.value);
  if (isDay(expression, 'asOf')) {
    return { name: 'день расчёта', genitive: 'дня расчёта', instrumental: 'днём расчёта' };
  }
  if (expression?.op === 'day') {
    const value = operand(expression.value);
    return { name: `календарный день для ${value.genitive ?? value.name}` };
  }
  if (expression?.op === 'otherwise') {
    if (isField(expression.left, 'dueDate') && isDay(expression.right, 'dueAt')) {
      return {
        name: 'дата срока', genitive: 'даты срока', instrumental: 'датой срока',
        absent: 'не указаны ни дата срока, ни его точное время',
        present: 'указана дата срока или его точное время',
      };
    }
    const left = operand(expression.left);
    const right = operand(expression.right);
    return {
      name: `${left.name}, а если это значение неизвестно — ${right.name}`,
      absent: `${left.name} и ${right.name} неизвестны`,
      present: `известно хотя бы одно значение: ${left.name} или ${right.name}`,
    };
  }
  throw new Error('Unsupported condition operand: ' + expression?.op);
}

function equality(expression, negative, kind) {
  const { left, right } = expression;
  // Literal on either side has identical equality semantics.
  if (left === null || typeof left !== 'object') {
    if (right === null || typeof right !== 'object') {
      return (left === right) !== negative ? 'условие выполняется всегда' : 'условие никогда не выполняется';
    }
    return equality({ left: right, right: left }, negative, kind);
  }
  const subject = operand(left);
  if (right === null) {
    return negative ? subject.present ?? `${subject.name}: данные есть`
      : subject.absent ?? `${subject.name}: данных нет`;
  }
  if (right === true && subject.yes) return negative ? subject.notYes : subject.yes;
  if (right === false && subject.no) {
    return negative ? `${subject.name}: указано «да» или нет данных` : subject.no;
  }
  if (isField(left, 'message.signal')) {
    if (right === 'none') return negative ? 'в сообщении есть значимые сведения' : 'в сообщении нет подтверждающих сведений';
    const signal = right === 'missing' && kind === 'onboarding' ? 'нехватке документов' : SIGNALS[right];
    if (signal) return `в сообщении ${negative ? 'нет сведений' : 'говорится'} о ${signal}`;
  }
  if (isField(left, 'crm.documents') && DOCUMENTS[right]) {
    return negative ? `статус в CRM отличается от «${DOCUMENTS[right]}» или неизвестен`
      : `в CRM указано, что ${DOCUMENTS[right]}`;
  }
  if (right && typeof right === 'object') {
    const other = operand(right);
    const withOther = other.instrumental ?? `значением «${other.name}»`;
    return `${subject.name} ${negative ? 'не совпадает' : 'совпадает'} с ${withOther}`;
  }
  return `${subject.name}: значение ${negative ? 'отличается от' : 'равно'} «${String(right)}»`;
}

function comparison(expression, negative) {
  const left = operand(expression.left);
  const right = operand(expression.right);
  if (left.dated && right.eventInstrumental) {
    return negative
      ? `${left.dated} одновременно с ${right.eventInstrumental} или позже, либо время одного из событий неизвестно`
      : `${left.dated} раньше ${right.eventGenitive}`;
  }
  if (negative) {
    return `${left.name} совпадает с ${right.instrumental ?? `значением «${right.name}»`} или позже; либо хотя бы одно из этих времён неизвестно`;
  }
  // after(a, b) is represented by before(b, a); keep the event first in prose.
  if (left.path === 'asOf') return `${right.name} позже времени расчёта`;
  return `${left.name} раньше ${right.genitive ?? `значения «${right.name}»`}`;
}

/** Push negations to individual facts; preserve AND/OR grouping in the rendered list. */
export function conditionView(expression, { kind } = {}, negative = false) {
  if (expression === true || expression === false) {
    return { text: expression !== negative ? 'условие выполняется всегда' : 'условие никогда не выполняется' };
  }
  switch (expression?.op) {
    case 'not': return conditionView(expression.value, { kind }, !negative);
    case 'all':
    case 'any': {
      const mode = negative ? (expression.op === 'all' ? 'any' : 'all') : expression.op;
      const items = expression.values.map(value => conditionView(value, { kind }, negative))
        .flatMap(value => value.mode === mode ? value.items : [value]);
      return { mode, items };
    }
    case 'eq': return { text: equality(expression, negative, kind) };
    case 'before': return { text: comparison(expression, negative) };
    default: throw new Error('Unknown rule expression: ' + expression?.op);
  }
}

export function conditionText(view, depth = 0) {
  if (view.text) return view.text;
  const heading = view.mode === 'all' ? 'выполнены все условия' : 'выполнено хотя бы одно условие';
  return heading + ':\n' + view.items.map(item =>
    '  '.repeat(depth + 1) + '• ' + conditionText(item, depth + 1)
  ).join('\n');
}

export function describe(expression, options) {
  return conditionText(conditionView(expression, options));
}
