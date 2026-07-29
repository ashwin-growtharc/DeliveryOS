import { secret } from '../../../../package.json';
export const Evil = () => <div>{JSON.stringify(secret)}</div>;
