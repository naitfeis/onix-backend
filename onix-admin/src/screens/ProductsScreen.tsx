import { useEffect, useState } from 'react';
import { adminApi, AdminApiError } from '../api/client';

type Product = {
  id: string; lotNumber: number; title: string; status: string; priceCents: string;
  quantity: number; createdAt: string; seller: { onixId: string; displayName?: string | null };
};

export function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await adminApi<{ products: Product[] }>(`/api/admin/products?limit=200${status ? `&status=${status}` : ''}`);
      setProducts(result.products);
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Failed'); }
  }
  useEffect(() => { void load(); }, []);
  async function archive(id: string) {
    try {
      await adminApi(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
      await load();
    } catch (e) { setError(e instanceof AdminApiError ? e.message : 'Action failed'); }
  }
  return <div className="panel">
    <h2>Product moderation</h2>
    <div className="row">
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option><option>ACTIVE</option><option>ARCHIVED</option><option>RESERVED</option><option>SOLD_OUT</option>
      </select></label>
      <label>Moderation reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className="primary" type="button" onClick={() => void load()}>Load</button>
    </div>
    {error && <p className="error">{error}</p>}
    <table><thead><tr><th>Lot</th><th>Title</th><th>Seller</th><th>Status</th><th>Price / qty</th><th>Action</th></tr></thead>
      <tbody>{products.map((product) => <tr key={product.id}>
        <td>ONIXLOT-{product.lotNumber}</td><td>{product.title}</td><td>{product.seller.onixId}</td>
        <td>{product.status}</td><td>{product.priceCents}¢ / {product.quantity}</td>
        <td>{product.status !== 'ARCHIVED' && <button className="danger" type="button" onClick={() => void archive(product.id)}>Remove listing</button>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
