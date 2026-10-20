/** Fictional sample from the test assignment. The snapshot never uses today's clock. */
export const SAMPLE = {
  snapshot: { label: "Понедельник · 10:00", date: "2026-10-19T10:00:00+03:00" },
  cases: [
    {
      id: "С-17", kind: "onboarding", title: "Оформление сотрудника", deadlineLabel: "Первый выход — завтра",
      crm: { status: "Документы ожидаются", documents: "pending", managerApproved: false, completed: false, receivedAt: null },
      message: { author: "Сотрудник", text: "Вчера отправил фотографии документов руководителю в личку", signal: "sent", notBefore: null },
    },
    {
      id: "С-24", kind: "offboarding", title: "Увольнение сотрудника", deadlineLabel: "Последний рабочий день — сегодня",
      crm: { status: "Подтверждение руководителя отсутствует", documents: "pending", managerApproved: false, completed: false, receivedAt: null },
      message: { author: "Сотрудник", text: "С руководителем всё обсудили, он в курсе", signal: "aware", notBefore: null },
    },
    {
      id: "П-08", kind: "delivery", title: "Поставка карт", deadlineLabel: "Доставка — сегодня до 10:00",
      crm: { status: "В пути", documents: "pending", managerApproved: false, completed: false, receivedAt: null },
      message: { author: "Курьер", text: "Задерживаюсь, раньше 13:00 не приеду", signal: "delay", notBefore: "13:00" },
    },
    {
      id: "П-09", kind: "delivery", title: "Поставка карт", deadlineLabel: "Приёмка — сегодня в 09:20",
      crm: { status: "Принято", documents: "pending", managerApproved: false, completed: true, receivedAt: "09:20" },
      message: { author: "Получатель", text: "Карты получили, количество проверили", signal: "received", notBefore: null },
    },
  ],
};
