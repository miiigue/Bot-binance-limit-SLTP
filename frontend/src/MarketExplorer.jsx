import React, { useState, useEffect, useMemo } from 'react';

const MarketExplorer = () => {
    const [coins, setCoins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [minPrice, setMinPrice] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [minVolume, setMinVolume] = useState('');
    const [performance, setPerformance] = useState('all'); // 'all', 'gainers', 'losers'
    const [sortBy, setSortBy] = useState({ key: 'quoteVolume', order: 'desc' });

    useEffect(() => {
        const fetchMarketData = async () => {
            try {
                // Hacemos el fetch a la URL relativa. Vite se encargará de redirigirla.
                const response = await fetch('/api/market_data');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                setCoins(data);
            } catch (e) {
                setError(e.message);
                console.error("Error fetching market data:", e);
            } finally {
                setLoading(false);
            }
        };

        fetchMarketData();
        // Refrescar datos cada 30 segundos
        const intervalId = setInterval(fetchMarketData, 30000); 

        return () => clearInterval(intervalId); // Limpiar intervalo al desmontar el componente
    }, []);

    const filteredAndSortedCoins = useMemo(() => {
        let filtered = coins.filter(coin => {
            if (searchTerm && !coin.symbol.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (minPrice && coin.price < parseFloat(minPrice)) return false;
            if (maxPrice && coin.price > parseFloat(maxPrice)) return false;
            if (minVolume && coin.quoteVolume < parseFloat(minVolume)) return false;
            if (performance === 'gainers' && coin.priceChangePercent <= 0) return false;
            if (performance === 'losers' && coin.priceChangePercent >= 0) return false;
            return true;
        });

        filtered.sort((a, b) => {
            const valA = a[sortBy.key];
            const valB = b[sortBy.key];
            if (valA < valB) return sortBy.order === 'asc' ? -1 : 1;
            if (valA > valB) return sortBy.order === 'asc' ? 1 : -1;
            return 0;
        });

        return filtered;
    }, [coins, searchTerm, minPrice, maxPrice, minVolume, performance, sortBy]);

    const handleSort = (key) => {
        if (sortBy.key === key) {
            setSortBy({ key, order: sortBy.order === 'asc' ? 'desc' : 'asc' });
        } else {
            setSortBy({ key, order: 'desc' });
        }
    };

    const SortIcon = ({ columnKey }) => {
        if (sortBy.key !== columnKey) return <span className="text-gray-500">↑↓</span>;
        return sortBy.order === 'asc' ? <span className="text-green-400">↑</span> : <span className="text-red-400">↓</span>;
    };
    
    if (loading) return <div className="text-center p-4">Cargando datos del mercado...</div>;
    if (error) return <div className="text-center p-4 text-red-500">Error al cargar datos: {error}. Asegúrate de que el backend está corriendo.</div>;

    return (
        <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg">
            <h2 className="text-xl sm:text-2xl font-bold text-green-400 mb-4">Explorador de Mercado de Futuros</h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                <input
                    type="text"
                    placeholder="Buscar moneda..."
                    className="bg-gray-700 text-white placeholder-gray-400 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 col-span-1 sm:col-span-2 lg:col-span-1"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                <input
                    type="number"
                    placeholder="Precio Mín."
                    className="bg-gray-700 text-white placeholder-gray-400 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                />
                <input
                    type="number"
                    placeholder="Precio Máx."
                    className="bg-gray-700 text-white placeholder-gray-400 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                />
                <input
                    type="number"
                    placeholder="Volumen Mín. (USDT)"
                    className="bg-gray-700 text-white placeholder-gray-400 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={minVolume}
                    onChange={(e) => setMinVolume(e.target.value)}
                />
                <select
                    className="bg-gray-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    value={performance}
                    onChange={(e) => setPerformance(e.target.value)}
                >
                    <option value="all">Todos</option>
                    <option value="gainers">Ganadoras</option>
                    <option value="losers">Perdedoras</option>
                </select>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-700">
                    <thead className="bg-gray-700">
                        <tr>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('symbol')}>
                                Símbolo <SortIcon columnKey="symbol" />
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('price')}>
                                Precio <SortIcon columnKey="price" />
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('priceChangePercent')}>
                                Cambio 24h <SortIcon columnKey="priceChangePercent" />
                            </th>
                            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('quoteVolume')}>
                                Volumen 24h (USDT) <SortIcon columnKey="quoteVolume" />
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-gray-800 divide-y divide-gray-700">
                        {filteredAndSortedCoins.map((coin) => (
                            <tr key={coin.symbol} className="hover:bg-gray-700">
                                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-white">{coin.symbol}</td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">${coin.price.toLocaleString()}</td>
                                <td className={`px-4 py-3 whitespace-nowrap text-sm font-semibold ${coin.priceChangePercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    {coin.priceChangePercent.toFixed(2)}%
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">${coin.quoteVolume.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default MarketExplorer; 