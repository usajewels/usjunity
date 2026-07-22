import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type { ApiError } from '../types';

const TOKEN_KEY = 'mxsuite_token';
const USER_KEY = 'mxsuite_user';
const TENANT_KEY = 'mxsuite_tenant_id';
const TENANT_DATA_KEY = 'mxsuite_tenant';

function attachInterceptors(instance: AxiosInstance): void {
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const tenantId = localStorage.getItem(TENANT_KEY);
    if (tenantId) {
      config.headers['X-Tenant-Id'] = tenantId;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiError>) => {
      if (error.response?.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(TENANT_KEY);
        localStorage.removeItem(TENANT_DATA_KEY);
        window.location.href = '/login';
      }
      const apiError: ApiError = error.response?.data ?? {
        status: error.response?.status ?? 500,
        message: error.message,
        timestamp: new Date().toISOString(),
      };
      return Promise.reject(apiError);
    }
  );
}

export class ApiClient {
  readonly instance: AxiosInstance;

  constructor(baseURL: string = '/api') {
    this.instance = axios.create({ baseURL });
    attachInterceptors(this.instance);
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<T>(url, config);
    return response.data;
  }

  async upload<T>(url: string, file: File, fieldName: string = 'file'): Promise<T> {
    const formData = new FormData();
    formData.append(fieldName, file);
    const response = await this.instance.post<T>(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }
}

export const apiClient = new ApiClient();

/** Raw configured Axios instance — use when you need AxiosResponse (e.g. `{ data }` destructuring) */
export const api = apiClient.instance;
