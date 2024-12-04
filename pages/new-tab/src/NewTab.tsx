import '@src/NewTab.css';
import '@src/NewTab.scss';
import React, { useState } from 'react';

import { Play, FileText, Search, Database, Zap, CloudLightning } from 'lucide-react';

const BeCuratorLandingPage = () => {
    return (
        <div className="min-h-screen bg-gray-50 text-gray-900">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-white shadow-md">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="text-2xl font-bold text-blue-600">BeCurator</div>
                    <nav className="space-x-4">
                        <a href="#" className="hover:text-blue-600 transition">功能</a>
                        <a href="#" className="hover:text-blue-600 transition">文档</a>
                        <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
                            立即下载
                        </button>
                    </nav>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-12 space-y-16">
                {/* Hero Section */}
                <section className="text-center">
                    <h1 className="text-5xl font-bold mb-4 text-gray-900">
                        BeCurator: 个人知识管理的革命性工具
                    </h1>
                    <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
                        一站式知识收集、本地存储和智能检索平台，将您的知识转化为可即时访问的个人智能助理。
                    </p>
                    <div className="flex justify-center space-x-4">
                        <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition">
                            免费下载
                        </button>
                        <button className="border border-blue-600 text-blue-600 px-6 py-3 rounded-lg hover:bg-blue-50 transition">
                            了解更多
                        </button>
                    </div>
                </section>

                {/* What is BeCurator */}
                <section className="grid md:grid-cols-2 gap-12 items-center">
                    <div>
                        <h2 className="text-3xl font-semibold mb-6">产品是什么?</h2>
                        <p className="text-gray-700 text-lg leading-relaxed mb-6">
                            BeCurator是一个本地知识管理平台，帮助您轻松收集、存储和智能检索各类信息。从网页、文档到在线资源，一键导入，智能向量化，实现快速、精准的知识检索。
                        </p>
                        <div className="space-y-4">
                            <div className="flex items-center space-x-4">
                                <FileText className="text-blue-600 w-10 h-10" />
                                <span className="text-gray-700">多源文件导入</span>
                            </div>
                            <div className="flex items-center space-x-4">
                                <Database className="text-blue-600 w-10 h-10" />
                                <span className="text-gray-700">本地向量数据库存储</span>
                            </div>
                            <div className="flex items-center space-x-4">
                                <Search className="text-blue-600 w-10 h-10" />
                                <span className="text-gray-700">智能语义搜索</span>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-lg shadow-lg p-6">
                        <img
                            src="/api/placeholder/600/400"
                            alt="BeCurator Interface"
                            className="w-full rounded-lg"
                        />
                    </div>
                </section>

                {/* Why Use BeCurator */}
                <section className="text-center bg-white py-16 rounded-lg shadow-md">
                    <h2 className="text-3xl font-semibold mb-8">为什么选择 BeCurator?</h2>
                    <div className="grid md:grid-cols-3 gap-8 px-8">
                        <div className="bg-gray-50 p-6 rounded-lg">
                            <Zap className="mx-auto text-blue-600 w-12 h-12 mb-4" />
                            <h3 className="text-xl font-semibold mb-4">高效检索</h3>
                            <p className="text-gray-600">
                                利用先进的向量搜索技术，秒级定位您需要的信息
                            </p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-lg">
                            <CloudLightning className="mx-auto text-blue-600 w-12 h-12 mb-4" />
                            <h3 className="text-xl font-semibold mb-4">本地部署</h3>
                            <p className="text-gray-600">
                                数据完全本地存储，保护您的隐私和数据安全
                            </p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-lg">
                            <Search className="mx-auto text-blue-600 w-12 h-12 mb-4" />
                            <h3 className="text-xl font-semibold mb-4">智能分析</h3>
                            <p className="text-gray-600">
                                AI驱动的深度分析，将零散知识转化为洞见
                            </p>
                        </div>
                    </div>
                </section>

                {/* How to Use */}
                <section>
                    <h2 className="text-3xl font-semibold text-center mb-12">如何使用</h2>
                    <div className="grid md:grid-cols-5 gap-6">
                        {[
                            { step: '下载安装', description: '从官网下载BeCurator' },
                            { step: '导入资源', description: '上传文档、网页链接' },
                            { step: '向量化', description: '系统自动处理数据' },
                            { step: '智能搜索', description: '使用自然语言查询' },
                            { step: '获取洞见', description: 'AI智能分析结果' }
                        ].map((item, index) => (
                            <div key={index} className="text-center">
                                <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                                    <span className="text-2xl font-bold text-blue-600">{index + 1}</span>
                                </div>
                                <h3 className="text-xl font-semibold mb-2">{item.step}</h3>
                                <p className="text-gray-600">{item.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Demo Video */}
                <section className="bg-white rounded-lg shadow-lg p-12 text-center">
                    <h2 className="text-3xl font-semibold mb-8">产品演示</h2>
                    <div className="max-w-4xl mx-auto">
                        <div className="w-full h-[500px] bg-gray-200 rounded-lg flex items-center justify-center relative">
                            <Play className="text-blue-600 w-24 h-24 absolute z-10" />
                            <div className="absolute inset-0 bg-black/30 rounded-lg"></div>
                            <span className="relative z-20 text-white text-2xl">
                                BeCurator Demo Video
                            </span>
                        </div>
                    </div>
                </section>

                {/* Upcoming Features */}
                <section className="text-center">
                    <h2 className="text-3xl font-semibold mb-12">即将推出的功能</h2>
                    <div className="grid md:grid-cols-4 gap-6">
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-semibold mb-4">跨平台同步</h3>
                            <p className="text-gray-600">多设备无缝同步知识库</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-semibold mb-4">协作知识库</h3>
                            <p className="text-gray-600">团队知识共享与协作</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-semibold mb-4">模型集成</h3>
                            <p className="text-gray-600">支持更多AI模型</p>
                        </div>
                        <div className="bg-white p-6 rounded-lg shadow-md">
                            <h3 className="text-xl font-semibold mb-4">插件生态</h3>
                            <p className="text-gray-600">丰富的插件扩展生态系统</p>
                        </div>
                    </div>
                </section>
            </main>

            {/* Footer */}
            <footer className="bg-white py-8 border-t">
                <div className="container mx-auto px-4 text-center text-gray-600">
                    © 2024 BeCurator. 保留所有权利。
                </div>
            </footer>
        </div>
    );
};

export default BeCuratorLandingPage;