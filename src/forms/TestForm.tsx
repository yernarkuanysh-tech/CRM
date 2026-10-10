import {useState} from 'react';
import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options, subtle} from '../components/ui';
import {testScales, validateTestScore} from '../lib/crm';
import {iso} from '../lib/dates';
import {useCrm} from '../state';
import type {Client, TestResult, TestType} from '../types';
import {rawValues, useFormAction} from './common';

const testTypes = Object.keys(testScales) as TestType[];
const testLabels = Object.fromEntries(testTypes.map(key => [key, testScales[key].label]));

export function TestForm({client, test: t}: {client: Client; test?: TestResult}) {
  const {updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const [type, setType] = useState<TestType>(t?.type || 'IELTS');
  const scale = testScales[type];
  const {error, onSubmit} = useFormAction(async form => {
    const data = rawValues(form);
    const score = validateTestScore(data.type, data.score, data.date);
    const value: TestResult = {id: t?.id || crypto.randomUUID(), type: data.type as TestType, score, date: data.date};
    const ok = await updateClient(client.id, draft => {
      draft.tests = draft.tests || [];
      const index = draft.tests.findIndex(x => x.id === value.id);
      if (index < 0) draft.tests.push(value);
      else draft.tests[index] = value;
    });
    if (!ok) return;
    modal.close();
    toast('Результат сохранён');
  });
  return (
    <form id="test-form" onSubmit={onSubmit}>
      <label>Тест и шкала<select name="type" id="test-type" value={type} onChange={e => setType(e.target.value as TestType)}><Options items={testTypes} labels={testLabels} /></select></label>
      <label>Общий результат<input id="test-score" name="score" type="number" required min={scale.min} max={scale.max} step={scale.step} defaultValue={t?.score ?? ''} /></label>
      <p className={subtle} id="test-hint">{`От ${scale.min} до ${scale.max}, шаг ${scale.step}.`}</p>
      <label>Дата сдачи<input type="date" name="date" max={iso(new Date())} defaultValue={t?.date || ''} /></label>
      <p className={subtle}>Указывайте балл из сертификата. Для TOEFL выбирайте шкалу, указанную в результате; пересчёт не выполняется.</p>
      <FormFooter label="Сохранить результат" error={error} onCancel={modal.close} />
    </form>
  );
}
