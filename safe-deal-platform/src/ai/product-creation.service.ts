import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductCategory, ProductCreationStatus, ProductSubcategory } from '@prisma/client';
import { SUBCATEGORIES_BY_CATEGORY } from '../catalog';
import { AuthUser } from '../common';
import { MarketplaceService } from '../marketplace.module';
import { minListingPriceCents } from '../pricing';
import { PrismaService } from '../prisma.service';
import { EntityExtractor, type ExtractedProductFields } from './entity-extractor';

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  STANDOFF_2: 'Standoff 2',
  STEAM: 'Steam',
  ROBLOX: 'Roblox',
  RP_PROJECTS: 'RP проекты',
  BRAWL_STARS: 'Brawl Stars',
  CS2: 'Counter-Strike 2',
  FORTNITE: 'Fortnite',
  VALORANT: 'Valorant',
  GTA_5: 'GTA 5',
  GTA_6: 'GTA 6',
  OTHER: 'Другое',
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  STANDOFF_GOLD: 'Gold', STANDOFF_ACCOUNTS: 'Аккаунты', STANDOFF_SKINS: 'Скины', STANDOFF_OTHER: 'Другое',
  STEAM_TOPUP: 'Пополнение', STEAM_ACCOUNTS: 'Аккаунты', STEAM_KEYS: 'Ключи', STEAM_SKINS: 'Скины', STEAM_OTHER: 'Другое',
  ROBLOX_ROBUX: 'Робуксы', ROBLOX_ACCOUNTS: 'Аккаунты', ROBLOX_ITEMS: 'Предметы', ROBLOX_OTHER: 'Другое',
  RP_VIRTS: 'Вирты', RP_ACCOUNTS: 'Аккаунты', RP_ITEMS: 'Предметы', RP_OTHER: 'Другое',
  BRAWL_DONATE: 'Донат', BRAWL_ACCOUNTS: 'Аккаунты', BRAWL_BOOST: 'Буст', BRAWL_OTHER: 'Другое',
  CS2_SKINS: 'Скины', CS2_ACCOUNTS: 'Аккаунты', CS2_BOOST: 'Буст', CS2_OTHER: 'Прочее',
  FORTNITE_DONATE: 'Донат', FORTNITE_ACCOUNTS: 'Аккаунты', FORTNITE_SERVICES: 'Услуги', FORTNITE_OTHER: 'Прочее',
  VALORANT_DONATE: 'Донат', VALORANT_ACCOUNTS: 'Аккаунты', VALORANT_SERVICES: 'Услуги', VALORANT_OTHER: 'Прочее',
  GTA5_DONATE: 'Донат', GTA5_CURRENCY: 'Валюта', GTA5_ACCOUNTS: 'Аккаунты', GTA5_SERVICES: 'Услуги', GTA5_OTHER: 'Прочее',
  GTA6_ACCOUNTS: 'Аккаунты', GTA6_KEYS: 'Ключи',
  OTHER_ACCOUNTS: 'Аккаунты', OTHER_ITEMS: 'Предметы', OTHER_BOOST: 'Буст', OTHER_MISC: 'Прочее',
};

type SessionRow = {
  id: string;
  title: string | null;
  category: ProductCategory | null;
  subcategory: ProductSubcategory | null;
  priceCents: bigint | null;
  quantity: number | null;
  description: string | null;
  status: ProductCreationStatus;
  productId: string | null;
};

@Injectable()
export class ProductCreationService {
  private readonly extractor = new EntityExtractor();

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplace: MarketplaceService,
  ) {}

  async getActive(userId: bigint, chatId: string) {
    return this.prisma.productCreationSession.findFirst({
      where: {
        userId,
        chatId,
        status: { notIn: ['FINISHED'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async start(userId: bigint, chatId: string) {
    await this.prisma.productCreationSession.updateMany({
      where: { userId, chatId, status: { notIn: ['FINISHED'] } },
      data: { status: 'FINISHED' },
    });
    return this.prisma.productCreationSession.create({
      data: { userId, chatId, status: 'WAIT_TITLE' },
    });
  }

  async cancel(sessionId: string) {
    await this.prisma.productCreationSession.update({
      where: { id: sessionId },
      data: { status: 'FINISHED' },
    });
  }

  async resetForEdit(session: SessionRow) {
    return this.prisma.productCreationSession.update({
      where: { id: session.id },
      data: {
        title: null,
        category: null,
        subcategory: null,
        priceCents: null,
        quantity: null,
        description: null,
        productId: null,
        status: 'WAIT_TITLE',
      },
    });
  }

  applyExtract(session: SessionRow, extracted: ExtractedProductFields): Partial<SessionRow> & {
    descriptionSet?: boolean;
  } {
    const patch: Partial<SessionRow> & { descriptionSet?: boolean } = {};
    if (extracted.title) {
      const t = extracted.title.trim().slice(0, 32);
      const currentOk = Boolean(session.title && session.title.trim().length >= 5);
      if (t.length > 0 && !currentOk) patch.title = t;
    }
    if (extracted.category && !session.category) patch.category = extracted.category;
    const category = patch.category ?? session.category;
    if (extracted.subcategory && !session.subcategory) {
      if (!category || SUBCATEGORIES_BY_CATEGORY[category].includes(extracted.subcategory)) {
        patch.subcategory = extracted.subcategory;
      }
    }
    if (extracted.priceRubles != null && session.priceCents == null) {
      patch.priceCents = BigInt(Math.round(extracted.priceRubles * 100));
    }
    if (extracted.quantity != null && session.quantity == null) {
      patch.quantity = extracted.quantity;
    }
    if (session.description == null) {
      if (extracted.descriptionSkipped) {
        patch.description = '';
        patch.descriptionSet = true;
      } else if (extracted.description != null) {
        patch.description = extracted.description;
        patch.descriptionSet = true;
      }
    }
    return patch;
  }

  computeStatus(session: {
    title: string | null;
    category: ProductCategory | null;
    subcategory: ProductSubcategory | null;
    priceCents: bigint | null;
    quantity: number | null;
    description: string | null;
  }): ProductCreationStatus {
    if (!session.title || session.title.trim().length < 5) return 'WAIT_TITLE';
    if (!session.category) return 'WAIT_CATEGORY';
    if (!session.subcategory) return 'WAIT_SUBCATEGORY';
    if (session.priceCents == null) return 'WAIT_PRICE';
    if (session.quantity == null) return 'WAIT_QUANTITY';
    if (session.description == null) return 'WAIT_DESCRIPTION';
    return 'READY';
  }

  promptFor(status: ProductCreationStatus, session?: { category?: ProductCategory | null }): string {
    switch (status) {
      case 'WAIT_TITLE':
        return 'Как называется товар? (от 5 до 32 символов)';
      case 'WAIT_CATEGORY':
        return [
          'Выберите категорию:',
          'Steam · Standoff 2 · Roblox · RP проекты · Brawl Stars · Другое',
        ].join('\n');
      case 'WAIT_SUBCATEGORY': {
        const cat = session?.category;
        if (!cat) return 'Укажите подкатегорию.';
        const subs = SUBCATEGORIES_BY_CATEGORY[cat]
          .map((s) => SUBCATEGORY_LABELS[s] ?? s)
          .join(' · ');
        return `Выберите подкатегорию:\n${subs}`;
      }
      case 'WAIT_PRICE':
        return 'Укажите цену в рублях.';
      case 'WAIT_QUANTITY':
        return 'Сколько штук?';
      case 'WAIT_DESCRIPTION':
        return 'Добавьте описание или напишите «нет», чтобы пропустить.';
      case 'READY':
        return this.formatCard(session as SessionRow);
      default:
        return 'Чем помочь?';
    }
  }

  formatCard(session: SessionRow): string {
    const price = session.priceCents != null
      ? `${(Number(session.priceCents) / 100).toFixed(2)} ₽`
      : '—';
    return [
      'Проверьте карточку товара:',
      '',
      `Название: ${session.title ?? '—'}`,
      `Категория: ${session.category ? CATEGORY_LABELS[session.category] : '—'}`,
      `Подкатегория: ${session.subcategory ? (SUBCATEGORY_LABELS[session.subcategory] ?? session.subcategory) : '—'}`,
      `Цена: ${price}`,
      `Количество: ${session.quantity ?? '—'}`,
      `Описание: ${session.description?.trim() ? session.description : '—'}`,
      '',
      'Напишите «Опубликовать» или «Изменить».',
    ].join('\n');
  }

  async ingestMessage(session: SessionRow, text: string) {
    const extracted = this.extractor.extract(text, { category: session.category });
    // In WAIT_* single-field mode, treat whole message as that field when unlabeled
    const focused = this.focusExtract(session.status, text, extracted, session);
    const patch = this.applyExtract(session, focused);
    const next = {
      title: patch.title ?? session.title,
      category: patch.category ?? session.category,
      subcategory: patch.subcategory ?? session.subcategory,
      priceCents: patch.priceCents ?? session.priceCents,
      quantity: patch.quantity ?? session.quantity,
      description: patch.descriptionSet || patch.description !== undefined
        ? (patch.description ?? session.description)
        : session.description,
    };
    // Drop invalid subcategory when category changes
    if (next.category && next.subcategory
      && !SUBCATEGORIES_BY_CATEGORY[next.category].includes(next.subcategory)) {
      next.subcategory = null;
    }
    const status = this.computeStatus(next);
    const updated = await this.prisma.productCreationSession.update({
      where: { id: session.id },
      data: {
        title: next.title,
        category: next.category,
        subcategory: next.subcategory,
        priceCents: next.priceCents,
        quantity: next.quantity,
        description: next.description,
        status,
      },
    });
    return updated;
  }

  private focusExtract(
    status: ProductCreationStatus,
    text: string,
    extracted: ExtractedProductFields,
    session: SessionRow,
  ): ExtractedProductFields {
    const out = { ...extracted };
    const trimmed = text.trim();
    if (status === 'WAIT_TITLE' && !out.title) {
      const t = trimmed.slice(0, 32);
      if (t.length >= 1) out.title = t;
    }
    if (status === 'WAIT_CATEGORY' && !out.category) {
      out.category = this.extractor.parseCategory(trimmed);
    }
    if (status === 'WAIT_SUBCATEGORY' && !out.subcategory) {
      out.subcategory = this.extractor.parseSubcategory(trimmed, session.category);
    }
    if (status === 'WAIT_PRICE' && out.priceRubles == null) {
      out.priceRubles = this.extractor.parsePrice(trimmed);
    }
    if (status === 'WAIT_QUANTITY' && out.quantity == null) {
      out.quantity = this.extractor.parseQuantity(trimmed);
    }
    if (status === 'WAIT_DESCRIPTION' && out.description == null && !out.descriptionSkipped) {
      if (/^(нет|пропустить|-|—)$/i.test(trimmed)) out.descriptionSkipped = true;
      else out.description = trimmed.slice(0, 20_000);
    }
    return out;
  }

  async publish(user: AuthUser, session: SessionRow) {
    if (this.computeStatus(session) !== 'READY' && session.status !== 'READY') {
      throw new BadRequestException('Карточка ещё не готова к публикации.');
    }
    const title = session.title?.trim() ?? '';
    if (title.length < 5 || title.length > 32) {
      throw new BadRequestException('Название должно быть от 5 до 32 символов.');
    }
    if (!session.category || !session.subcategory || session.priceCents == null || session.quantity == null) {
      throw new BadRequestException('Заполнены не все поля.');
    }
    const min = minListingPriceCents(session.subcategory);
    if (session.priceCents < min) {
      throw new BadRequestException(`Минимальная цена: ${Number(min) / 100} ₽`);
    }

    const product = await this.marketplace.create(user, {
      title,
      description: session.description?.trim() || undefined,
      priceCents: session.priceCents.toString(),
      category: session.category,
      subcategory: session.subcategory,
      quantity: session.quantity,
      autoDeliver: false,
    });

    await this.prisma.productCreationSession.update({
      where: { id: session.id },
      data: { status: 'FINISHED', productId: product.id },
    });

    const lot = product.lotNumber ?? (await this.prisma.product.findUnique({
      where: { id: product.id },
      select: { lotNumber: true },
    }))?.lotNumber;

    return {
      productId: product.id,
      lotNumber: lot,
      message: [
        '✅ Товар опубликован.',
        '',
        `ONIXLOT-${lot}`,
        '',
        'Сохраните этот ONIXLOT-id — по нему лот можно открыть из любого чата.',
        'Нажмите «Открыть товар» ниже.',
      ].join('\n'),
    };
  }
}
