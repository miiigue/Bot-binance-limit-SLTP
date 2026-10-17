from src.database import get_db_connection, get_user_api_keys, get_user_bot_settings, get_user_trading_metrics

conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT id, username, role, email, status FROM users WHERE username LIKE '%Quiero%' OR username LIKE '%quiero%'")
users = cur.fetchall()
print("Users found:", users)

for u in users:
    uid = u['id'] if isinstance(u, dict) else u[0]
    print(f"\n--- User {uid} ---")
    keys = get_user_api_keys(uid, decrypt=True)
    if keys:
        print("API Keys:", {k: v for k, v in keys.items() if k != 'api_secret'})
    settings = get_user_bot_settings(uid)
    print("Bot Settings:", settings)
    metrics = get_user_trading_metrics(uid)
    print("Trading Metrics:", metrics)
    
    cur.execute("SELECT * FROM investor_transactions WHERE user_id = %s", (uid,))
    txs = cur.fetchall()
    print("Transactions:", txs)
    
    cur.execute("SELECT COUNT(*), SUM(pnl_usdt) FROM user_trades WHERE user_id = %s", (uid,))
    trades_summary = cur.fetchall()
    print("User Trades Summary:", trades_summary)

conn.close()
