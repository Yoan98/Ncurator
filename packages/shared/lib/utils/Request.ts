import type { AxiosRequestConfig, AxiosResponse, AxiosError, AxiosInstance } from 'axios';
import axios from 'axios';


interface HttpRequestConfig extends AxiosRequestConfig {
    errorHandle?: (err: AxiosError) => void;
}

interface HttpRequestOptions extends AxiosRequestConfig { }

export class HttpRequest {
    private axiosConfig: HttpRequestConfig;
    private errorHandle: (err: AxiosError) => void;

    constructor(axiosConfig: HttpRequestConfig = {}, errorHandle: (err: AxiosError) => void = () => { }) {
        this.axiosConfig = this._getConfig(axiosConfig);
        this.errorHandle = errorHandle;
    }

    private _getConfig(axiosConfig: HttpRequestConfig): HttpRequestConfig {
        const config: HttpRequestConfig = {
            baseURL: '',
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            ...axiosConfig
        };
        return config;
    }


    private _interceptors(instance: AxiosInstance): void {
        instance.interceptors.request.use(
            (config) => {
                // Do something before request is sent

                return config;
            },
            (err: AxiosError) => {
                // Do something with request error

                this.errorHandle(err);
                return Promise.reject(err);
            }
        );

        instance.interceptors.response.use(
            (res: AxiosResponse) => {
                // Do something with response data

                return Promise.reject(res);
            },
            (err: AxiosError) => {
                // Do something with response error

                this.errorHandle(err);
                return Promise.reject(err);
            }
        );
    }

    private request(options: HttpRequestOptions): Promise<any> {
        const instance = axios.create();
        this._interceptors(instance);
        const newOptions = { ...this.axiosConfig, ...options };
        return instance(newOptions);
    }

    public get(url: string, params?: any, options?: HttpRequestOptions): Promise<any> {
        const config: HttpRequestOptions = {
            url,
            method: 'get',
            params,
            ...options
        };
        return this.request(config);
    }

    public post(url: string, data?: any, options?: HttpRequestOptions): Promise<any> {
        const config: HttpRequestOptions = {
            url,
            method: 'post',
            data,
            ...options
        };
        return this.request(config);
    }
}