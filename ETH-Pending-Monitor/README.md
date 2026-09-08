# ETH Pending Monitor

Онлайн-монитор pending-транзакций Ethereum для адреса:

`0xcED92FA7f0797cBc851B48140aE218a0b0D41ce0`

## Публикация через Visual Studio

1. Распакуйте архив и откройте папку `ETH-Pending-Monitor` в Visual Studio.
2. Откройте меню **Git → Create Git Repository**.
3. Выберите GitHub, укажите название репозитория и включите **Public**.
4. Нажмите **Create and Push**.
5. Откройте созданный репозиторий на GitHub.
6. Перейдите в **Settings → Pages**.
7. В **Build and deployment** выберите **Deploy from a branch**.
8. Укажите ветку `main`, папку `/ (root)` и нажмите **Save**.

После публикации откройте выданную GitHub Pages ссылку, нажмите **Настроить подключение** и вставьте новый Alchemy WebSocket URL формата:

`wss://eth-mainnet.g.alchemy.com/v2/ВАШ_КЛЮЧ`

Alchemy URL сохраняется только локально в браузере. Мониторинг работает, пока страница открыта.
