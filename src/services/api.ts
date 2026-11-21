export async function readJson<T>(result: Response): Promise<T> {
  const data = await result.json();
  if (!result.ok) throw new Error(data.error);
  return data as T;
}
