import { PrismaService } from './prisma.service'; // ИСПРАВЛЕНИЕ: Импортируем наш рабочий сервис
import { TelegramUtil } from './utils/telegram.util';
import 'dotenv/config';

// ИСПРАВЛЕНИЕ: Инициализируем наш PrismaService, который уже умеет работать с адаптером пула Prisma 7
const prisma = new PrismaService();

async function runTest() {
  console.log('⏳ Подключение к базе данных ONIX_db...');
  await prisma.$connect();

  // 1. Имитируем регистрацию нового пользователя на сайте
  const testEmail = `user_${Date.now()}@onix.p2p`;
  console.log(`👤 Создание тестового пользователя: ${testEmail}`);

  const user = await prisma.user.create({
    data: {
      email: testEmail,
    },
  });

  // 2. Имитируем клик по кнопке "Привязать Telegram" на сайте
  const token = TelegramUtil.generateLinkingToken();

  // Сохраняем временный OTP-токен в базу данных к этому пользователю
  await prisma.user.update({
    where: { id: user.id },
    data: { telegramToken: token },
  });

  console.log('✅ Токен успешно сгенерирован и привязан в БД.');
  console.log('\n==================================================');
  console.log('🚀 ССЫЛКА ДЛЯ ТЕСТИРОВАНИЯ БОТА:');

  // ❗️ ВНИМАНИЕ: Замените '@Onixshop_bot' ниже на точный юзернейм ВАШЕГО бота из @BotFather!
  const botUsername = 'Onixshop_bot';
  const deepLink = TelegramUtil.buildDeepLink(botUsername, token);

  console.log(deepLink);
  console.log('==================================================\n');
  console.log('👉 Перейдите по этой ссылке, запустите бота и проверьте логи бэкенда!');

  await prisma.$disconnect();
}

runTest().catch((err) => {
  console.error('❌ Ошибка во время теста:', err);
});