import { useState, useEffect } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState(null);
  const [loginName, setLoginName] = useState("");

  const [stocks, setStocks] = useState([]);
  const [newStock, setNewStock] = useState("");
  const [marketData, setMarketData] = useState({});
  const [previousData, setPreviousData] = useState({});
  const [loading, setLoading] = useState({});
  const [authLoading, setAuthLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // Restore session from localStorage on first load
  useEffect(() => {
    const saved = localStorage.getItem("watchlist_user");

    if (saved) {
      try {
        const user = JSON.parse(saved);

        if (user && user.id && user.name) {
          setUserId(user.id);
          setUserName(user.name);
          setLoggedIn(true);
          loadWatchlist(user.id);
        }
      } catch (error) {
        console.error("Session restore error:", error);
        localStorage.removeItem("watchlist_user");
      }
    }

    setRestoring(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login() {
    const name = loginName.trim();

    if (!name) {
      alert("Please enter your name.");
      return;
    }

    if (name.length < 2) {
      alert("Please enter a valid name.");
      return;
    }

    setAuthLoading(true);

    try {
      const response = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Could not log in.");
        return;
      }

      const user = data.user;

      setUserId(user.id);
      setUserName(user.name);
      setLoggedIn(true);
      setLoginName("");

      localStorage.setItem(
        "watchlist_user",
        JSON.stringify({ id: user.id, name: user.name })
      );

      await loadWatchlist(user.id);
    } catch (error) {
      console.error("Login error:", error);
      alert("Could not connect to the backend.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadWatchlist(id) {
    try {
      const response = await fetch(`${API}/api/watchlist/${id}`);
      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Could not load watchlist.");
        return;
      }

      const watchlist = data.watchlist || [];

      setStocks(watchlist);
      setMarketData({});
      setPreviousData({});

      // Fetch all symbols in parallel instead of one at a time
      await Promise.all(
        watchlist.map((item) => fetchMarketData(item.symbol, id))
      );
    } catch (error) {
      console.error("Load watchlist error:", error);
      alert("Could not load your watchlist.");
    }
  }

  async function getPreviousSnapshot(symbol, id) {
    try {
      const response = await fetch(
        `${API}/api/snapshots/${id}/${encodeURIComponent(
          symbol
        )}/previous`
      );

      const data = await response.json();

      if (data.success && data.previous) {
        setPreviousData((current) => ({
          ...current,
          [symbol]: data.previous
        }));
      } else {
        setPreviousData((current) => ({
          ...current,
          [symbol]: null
        }));
      }
    } catch (error) {
      console.error("Previous snapshot error:", error);

      setPreviousData((current) => ({
        ...current,
        [symbol]: null
      }));
    }
  }

  async function saveSnapshot(id, data) {
    try {
      await fetch(`${API}/api/snapshots/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          symbol: data.symbol,
          price: data.price,
          previousClose: data.previousClose
        })
      });
    } catch (error) {
      console.error("Save snapshot error:", error);
    }
  }

  async function fetchMarketData(symbol, id = userId) {
    const cleanSymbol = symbol.trim().toUpperCase();

    if (!cleanSymbol || !id) {
      return;
    }

    setLoading((current) => ({
      ...current,
      [cleanSymbol]: true
    }));

    try {
      await getPreviousSnapshot(cleanSymbol, id);

      const response = await fetch(
        `${API}/api/market/${encodeURIComponent(cleanSymbol)}`
      );

      const data = await response.json();

      if (!response.ok) {
        alert(
          data.message ||
            `Could not find market data for ${cleanSymbol}.`
        );
        return;
      }

      setMarketData((current) => ({
        ...current,
        [cleanSymbol]: data
      }));

      await saveSnapshot(id, data);
    } catch (error) {
      console.error("Market data error:", error);
      alert("Could not load market data.");
    } finally {
      setLoading((current) => ({
        ...current,
        [cleanSymbol]: false
      }));
    }
  }

  async function addStock() {
    const symbol = newStock.trim().toUpperCase();

    if (!symbol) {
      alert("Please enter a stock symbol.");
      return;
    }

    if (stocks.some((item) => item.symbol === symbol)) {
      alert(`${symbol} is already in your watchlist.`);
      return;
    }

    setLoading((current) => ({
      ...current,
      [symbol]: true
    }));

    try {
      const marketResponse = await fetch(
        `${API}/api/market/${encodeURIComponent(symbol)}`
      );

      const market = await marketResponse.json();

      if (!marketResponse.ok) {
        alert(
          market.message ||
            `Could not find market data for ${symbol}.`
        );
        return;
      }

      const response = await fetch(
        `${API}/api/watchlist/${userId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            symbol
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Could not add stock.");
        return;
      }

      setStocks((current) => [
        ...current,
        data.watchlist
      ]);

      setMarketData((current) => ({
        ...current,
        [symbol]: market
      }));

      setPreviousData((current) => ({
        ...current,
        [symbol]: null
      }));

      await saveSnapshot(userId, market);

      setNewStock("");
    } catch (error) {
      console.error("Add stock error:", error);
      alert("Could not connect to the backend.");
    } finally {
      setLoading((current) => ({
        ...current,
        [symbol]: false
      }));
    }
  }

  async function removeStock(symbol) {
    const confirmed = window.confirm(
      `Remove ${symbol} from your watchlist?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${API}/api/watchlist/${userId}/${encodeURIComponent(
          symbol
        )}`,
        {
          method: "DELETE"
        }
      );

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || "Could not remove stock.");
        return;
      }

      setStocks((current) =>
        current.filter((item) => item.symbol !== symbol)
      );

      setMarketData((current) => {
        const updated = { ...current };
        delete updated[symbol];
        return updated;
      });

      setPreviousData((current) => {
        const updated = { ...current };
        delete updated[symbol];
        return updated;
      });
    } catch (error) {
      console.error("Remove stock error:", error);
      alert("Could not connect to the backend.");
    }
  }

  function logout() {
    localStorage.removeItem("watchlist_user");

    setLoggedIn(false);
    setUserId(null);
    setUserName("");
    setStocks([]);
    setMarketData({});
    setPreviousData({});
    setNewStock("");
    setLoginName("");
  }

  function formatPrice(price) {
    if (!Number.isFinite(Number(price))) {
      return "—";
    }

    return `₹${Number(price).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function getVisitChange(symbol) {
    const current = marketData[symbol];
    const previous = previousData[symbol];

    if (
      !current ||
      !previous ||
      !Number.isFinite(Number(previous.price)) ||
      Number(previous.price) === 0
    ) {
      return null;
    }

    const difference =
      Number(current.price) - Number(previous.price);

    const percentage =
      (difference / Number(previous.price)) * 100;

    return {
      difference,
      percentage
    };
  }

  // A stock only counts as "meaningfully changed" if it moved
  // at least 2% since the user's last visit (see README).
  const changedStocks = stocks.filter((item) => {
    const change = getVisitChange(item.symbol);

    return (
      change &&
      Math.abs(change.percentage) >= 2
    );
  });

  const stocksUp = changedStocks.filter(
    (item) =>
      getVisitChange(item.symbol)?.percentage > 0
  );

  const stocksDown = changedStocks.filter(
    (item) =>
      getVisitChange(item.symbol)?.percentage < 0
  );

  // Avoid flashing the login screen while we check localStorage
  if (restoring) {
    return (
      <div className="app">
        <main className="login-page">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <div className="app">
        <header className="header">
          <h1>Market Watchlist</h1>
        </header>

        <main className="login-page">
          <section className="login-card">
            <div className="login-heading">
              <p className="eyebrow">
                SMART MARKET WATCHLIST
              </p>

              <h2>
                Track the market,
                <br />
                your way.
              </h2>
            </div>

            <div className="form-group">
              <label htmlFor="name">
                Name
              </label>

              <input
                id="name"
                type="text"
                placeholder="Enter your name"
                value={loginName}
                onChange={(event) =>
                  setLoginName(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    login();
                  }
                }}
                disabled={authLoading}
              />
            </div>

            <button
              className="primary-button"
              onClick={login}
              disabled={authLoading}
            >
              {authLoading
                ? "Loading..."
                : "Continue"}
            </button>
          </section>

          <section className="landing-images">
            <div className="image-card">
              <img
                src="/1st.png"
                alt="Market chart visualization"
              />
            </div>

            <div className="image-card">
              <img
                src="/2nd.png"
                alt="Stock market visualization"
              />
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header dashboard-header">
        <h1>Market Watchlist</h1>

        <button
          className="logout-button"
          onClick={logout}
        >
          Log Out
        </button>
      </header>

      <main className="dashboard">
        <section className="welcome-section">
          <p className="eyebrow">
            YOUR PERSONAL MARKET VIEW
          </p>

          <h2>
            Hey, {userName}.
          </h2>

          <p>
            Here's what changed in your
            watchlist.
          </p>
        </section>

        <section className="add-section">
          <div>
            <p className="section-label">
              ADD STOCK
            </p>

            <h3>
              Build your watchlist
            </h3>
          </div>

          <div className="add-stock-form">
            <input
              type="text"
              placeholder="Example: RELIANCE"
              value={newStock}
              onChange={(event) =>
                setNewStock(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addStock();
                }
              }}
            />

            <button
              className="primary-button add-button"
              onClick={addStock}
              disabled={
                loading[
                  newStock.trim().toUpperCase()
                ]
              }
            >
              {loading[
                newStock.trim().toUpperCase()
              ]
                ? "Adding..."
                : "Add Stock"}
            </button>
          </div>
        </section>

        <section className="changes-section">
          <div className="section-heading-row">
            <div>
              <p className="section-label">
                WHAT CHANGED?
              </p>

              <h3>
                Since your last visit
              </h3>
            </div>

            <div className="change-summary">
              <span>
                Up {stocksUp.length}
              </span>

              <span>
                Down {stocksDown.length}
              </span>
            </div>
          </div>

          {changedStocks.length === 0 ? (
            <div className="empty-change">
              <h4>
                No changes to show yet
              </h4>

              <p>
                We'll compare your market
                data when you return.
              </p>
            </div>
          ) : (
            <div className="change-list">
              {changedStocks.map((item) => {
                const data =
                  marketData[item.symbol];

                const change =
                  getVisitChange(item.symbol);

                if (!data || !change) {
                  return null;
                }

                return (
                  <div
                    className="change-row"
                    key={item.symbol}
                  >
                    <div>
                      <strong>
                        {item.symbol}
                      </strong>

                      <span>
                        {formatPrice(data.price)}
                      </span>
                    </div>

                    <div
                      className={
                        change.percentage >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {change.percentage >= 0
                        ? "Up "
                        : "Down "}

                      {Math.abs(
                        change.percentage
                      ).toFixed(2)}
                      %
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="watchlist-section">
          <div className="section-heading-row">
            <div>
              <p className="section-label">
                MY WATCHLIST
              </p>

              <h3>
                {stocks.length}{" "}
                {stocks.length === 1
                  ? "stock"
                  : "stocks"}
              </h3>
            </div>
          </div>

          {stocks.length === 0 ? (
            <div className="empty-watchlist">
              <h4>
                Your watchlist is empty
              </h4>

              <p>
                Add your first stock above
                to start tracking real
                market data.
              </p>
            </div>
          ) : (
            <div className="stock-grid">
              {stocks.map((item) => {
                const data =
                  marketData[item.symbol];

                const previous =
                  previousData[item.symbol];

                const visitChange =
                  getVisitChange(item.symbol);

                const marketChange =
                  data &&
                  Number.isFinite(
                    Number(data.previousClose)
                  ) &&
                  Number(data.previousClose) !== 0
                    ? ((Number(data.price) -
                        Number(data.previousClose)) /
                        Number(data.previousClose)) *
                      100
                    : null;

                return (
                  <article
                    className="stock-card"
                    key={item.id}
                  >
                    <div className="stock-card-top">
                      <div>
                        <span className="stock-symbol">
                          {item.symbol}
                        </span>

                        <span className="stock-source">
                          {data?.exchange || "NSE"}
                        </span>
                      </div>

                      <button
                        className="refresh-button"
                        onClick={() =>
                          fetchMarketData(
                            item.symbol
                          )
                        }
                        disabled={
                          loading[item.symbol]
                        }
                      >
                        {loading[item.symbol]
                          ? "Loading..."
                          : "Refresh"}
                      </button>
                    </div>

                    {!data ? (
                      <div className="stock-loading">
                        Loading market data...
                      </div>
                    ) : (
                      <>
                        <div className="price">
                          {formatPrice(data.price)}
                        </div>

                        <div
                          className={
                            marketChange !== null &&
                            marketChange >= 0
                              ? "market-change positive"
                              : "market-change negative"
                          }
                        >
                          {marketChange === null
                            ? "Change unavailable"
                            : `${
                                marketChange >= 0
                                  ? "+"
                                  : ""
                              }${marketChange.toFixed(
                                2
                              )}% today`}
                        </div>

                        <div className="stock-details">
                          <div>
                            <span>
                              Previous close
                            </span>

                            <strong>
                              {formatPrice(
                                data.previousClose
                              )}
                            </strong>
                          </div>

                          <div>
                            <span>
                              Since last visit
                            </span>

                            <strong>
                              {previous &&
                              visitChange
                                ? `${
                                    visitChange.percentage >=
                                    0
                                      ? "+"
                                      : ""
                                  }${visitChange.percentage.toFixed(
                                    2
                                  )}%`
                                : "First visit"}
                            </strong>
                          </div>
                        </div>

                        {!previous && (
                          <p className="first-visit">
                            We'll track changes
                            from here.
                          </p>
                        )}

                        <div className="stock-footer">
                          <span>
                            {data.marketState &&
                            data.marketState !==
                              "UNKNOWN"
                              ? data.marketState
                              : "Market status unavailable"}

                            {" • "}

                            {data.source}
                          </span>

                          <button
                            className="remove-button"
                            onClick={() =>
                              removeStock(
                                item.symbol
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
