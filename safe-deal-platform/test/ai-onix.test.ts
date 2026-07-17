import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntityExtractor } from '../src/ai/entity-extractor';
import { IntentRecognizer } from '../src/ai/intent-recognizer';
import { ProductCreationService } from '../src/ai/product-creation.service';

describe('ONIX AI IntentRecognizer', () => {
  const ir = new IntentRecognizer();

  it('detects create product phrases', () => {
    assert.equal(ir.recognize('Создай товар'), 'CREATE_PRODUCT');
    assert.equal(ir.recognize('Создай новый товар'), 'CREATE_PRODUCT');
    assert.equal(ir.recognize('Новый товар'), 'CREATE_PRODUCT');
    assert.equal(ir.recognize('Добавить товар'), 'CREATE_PRODUCT');
  });

  it('future feature for as yesterday', () => {
    assert.equal(ir.recognize('Создай товар как вчера'), 'FUTURE');
  });

  it('help for greetings and FAQ', () => {
    assert.equal(ir.recognize('привет'), 'HELP');
    assert.equal(ir.recognize('Как продавать'), 'HELP');
    assert.equal(ir.recognize('Как работает система гаранта'), 'HELP');
    assert.equal(ir.recognize('Сколько ждать вывод'), 'HELP');
    assert.equal(ir.recognize('Как работает поддержка'), 'HELP');
  });

  it('publish/edit only when session ready', () => {
    assert.equal(ir.recognize('Опубликовать'), 'UNKNOWN');
    assert.equal(ir.recognize('Опубликовать', { sessionReady: true }), 'PUBLISH_PRODUCT');
    assert.equal(ir.recognize('Изменить', { sessionReady: true }), 'EDIT_PRODUCT');
  });
});

describe('ONIX AI EntityExtractor', () => {
  const ex = new EntityExtractor();

  it('extracts free-form title', () => {
    const got = ex.extract('PUBG Mobile');
    assert.equal(got.title, 'PUBG Mobile');
  });

  it('extracts all fields from one message', () => {
    const got = ex.extract([
      'Название PUBG Mobile',
      'Цена 300',
      'Количество 50',
      'Описание Передача обменом',
      'Категория Steam',
      'Подкатегория Валюта',
    ].join('\n'));
    assert.equal(got.title, 'PUBG Mobile');
    assert.equal(got.priceRubles, 300);
    assert.equal(got.quantity, 50);
    assert.equal(got.description, 'Передача обменом');
    assert.equal(got.category, 'STEAM');
    assert.equal(got.subcategory, 'STEAM_TOPUP');
  });
});

describe('ONIX AI ProductCreationService status machine', () => {
  const svc = Object.create(ProductCreationService.prototype) as ProductCreationService;

  it('asks only missing fields', () => {
    assert.equal(svc.computeStatus({
      title: null, category: null, subcategory: null, priceCents: null, quantity: null, description: null,
    }), 'WAIT_TITLE');
    assert.equal(svc.computeStatus({
      title: 'PUBG Mobile', category: null, subcategory: null, priceCents: null, quantity: null, description: null,
    }), 'WAIT_CATEGORY');
    assert.equal(svc.computeStatus({
      title: 'PUBG Mobile', category: 'STEAM', subcategory: 'STEAM_TOPUP',
      priceCents: 30000n, quantity: 50, description: 'ok',
    }), 'READY');
  });
});
