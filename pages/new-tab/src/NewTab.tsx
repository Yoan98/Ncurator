import '@src/NewTab.css';
import '@src/NewTab.scss';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
    FileText,
    Search,
    Database,
    Zap,
    Cloud,
    CheckCircle,
    Info
} from 'lucide-react';

const BeCuratorLandingPage = () => {
    const [isWebGPUSupported, setIsWebGPUSupported] = useState(false);

    const tabContents = {
        what: (
            <div className="grid md:grid-cols-2 gap-12 items-center">
                <div>
                    <h2 className="text-3xl font-semibold mb-6">产品是什么?</h2>
                    <p className="text-gray-700 text-lg leading-relaxed mb-6">
                        BeCurator是一个本地知识管理平台，帮助您轻松收集、存储和智能检索各类信息。从网页、文档到在线资源，一键导入，智能向量化，实现快速、精准的知识检索。
                    </p>
                    <div className="space-y-4">
                        {[
                            { icon: <FileText />, text: '多源文件导入' },
                            { icon: <Database />, text: '本地向量数据库存储' },
                            { icon: <Search />, text: '智能语义搜索' }
                        ].map((item, index) => (
                            <div key={index} className="flex items-center space-x-4">
                                <span className="text-2xl text-gray-700">{item.icon}</span>
                                <span className="text-gray-700">{item.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <img
                        src="/api/placeholder/600/400"
                        alt="BeCurator Interface"
                        className="w-full rounded-lg shadow-lg"
                    />
                </div>
            </div>
        ),
        why: (
            <div className="grid md:grid-cols-3 gap-8">
                {[
                    {
                        icon: <Zap />,
                        title: '高效检索',
                        desc: '利用先进的向量搜索技术，秒级定位您需要的信息'
                    },
                    {
                        icon: <Cloud />,
                        title: '本地部署',
                        desc: '数据完全本地存储，保护您的隐私和数据安全'
                    },
                    {
                        icon: <Search />,
                        title: '智能分析',
                        desc: 'AI驱动的深度分析，将零散知识转化为洞见'
                    }
                ].map((item, index) => (
                    <div key={index} className="text-center bg-gray-50 p-6 rounded-lg">
                        <div className="text-4xl mb-4 flex justify-center text-gray-700">{item.icon}</div>
                        <h3 className="text-xl font-semibold mb-4">{item.title}</h3>
                        <p className="text-gray-600">{item.desc}</p>
                    </div>
                ))}
            </div>
        ),
        how: (
            <div className="grid md:grid-cols-2 gap-12">
                <div>
                    <h2 className="text-3xl font-semibold mb-6">使用步骤</h2>
                    <ol className="space-y-4 list-decimal pl-5">
                        {[
                            { step: '下载安装', desc: '从官网下载BeCurator' },
                            { step: '导入资源', desc: '上传文档、网页链接' },
                            { step: '向量化', desc: '系统自动处理数据' },
                            { step: '智能搜索', desc: '使用自然语言查询' },
                            { step: '获取洞见', desc: 'AI智能分析结果' }
                        ].map((item, index) => (
                            <li key={index} className="mb-4">
                                <h3 className="text-xl font-semibold">{item.step}</h3>
                                <p className="text-gray-600">{item.desc}</p>
                            </li>
                        ))}
                    </ol>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    {[1, 2, 3, 4, 5].map((num) => (
                        <img
                            key={num}
                            src={`/api/placeholder/300/200?text=Step ${num}`}
                            alt={`Step ${num}`}
                            className="w-full h-48 object-cover rounded-lg shadow-md"
                        />
                    ))}
                </div>
            </div>
        ),
        features: (
            <div className="grid md:grid-cols-4 gap-6">
                {[
                    { title: '跨平台同步', desc: '多设备无缝同步知识库' },
                    { title: '协作知识库', desc: '团队知识共享与协作' },
                    { title: '模型集成', desc: '支持更多AI模型' },
                    { title: '插件生态', desc: '丰富的插件扩展生态系统' }
                ].map((item, index) => (
                    <div
                        key={index}
                        className="bg-white p-6 rounded-lg shadow-md text-center"
                    >
                        <h3 className="text-xl font-semibold mb-4">{item.title}</h3>
                        <p className="text-gray-600">{item.desc}</p>
                    </div>
                ))}
            </div>
        )
    };

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-white shadow-md">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="text-2xl font-bold text-gray-700">BeCurator</div>
                    <nav className="space-x-4">
                        <Button variant="ghost">功能</Button>
                        <Button variant="ghost">文档</Button>
                        <Button
                            style={{
                                backgroundColor: '#404040',
                                color: 'white'
                            }}
                        >
                            立即下载
                        </Button>
                    </nav>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-12">
                {/* Hero Section */}
                <section className="text-center mb-16">
                    <h1 className="text-5xl font-bold mb-4 text-gray-900">
                        BeCurator: 个人知识管理的革命性工具
                    </h1>
                    <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
                        一站式知识收集、本地存储和智能检索平台，将您的知识转化为可即时访问的个人智能助理。
                    </p>
                    <div className="flex justify-center space-x-4">
                        <Button
                            style={{
                                backgroundColor: '#404040',
                                color: 'white'
                            }}
                        >
                            免费下载
                        </Button>
                        <Button variant="outline">了解更多</Button>
                    </div>
                </section>

                {/* Tabbed Content */}
                <Tabs defaultValue="what" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 mb-8">
                        <TabsTrigger value="what">是什么</TabsTrigger>
                        <TabsTrigger value="why">为什么</TabsTrigger>
                        <TabsTrigger value="how">怎么用</TabsTrigger>
                        <TabsTrigger value="features">即将上线</TabsTrigger>
                    </TabsList>
                    <TabsContent value="what">{tabContents.what}</TabsContent>
                    <TabsContent value="why">{tabContents.why}</TabsContent>
                    <TabsContent value="how">{tabContents.how}</TabsContent>
                    <TabsContent value="features">{tabContents.features}</TabsContent>
                </Tabs>

                {/* Video Section */}
                <section className="mt-16 text-center">
                    <h2 className="text-3xl font-semibold mb-8">产品演示</h2>
                    <div className="max-w-4xl mx-auto bg-gray-200 h-[500px] rounded-lg flex items-center justify-center">
                        视频展示位置
                    </div>
                </section>

                {/* Recommended Configuration Section */}
                <section className="container mx-auto px-4 py-16 bg-gray-100">
                    <div className="max-w-4xl mx-auto">
                        <h2 className="text-3xl font-semibold mb-8 text-center">推荐配置</h2>
                        <div className="grid md:grid-cols-2 gap-8">
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h3 className="text-xl font-semibold mb-4 flex items-center">
                                    <CheckCircle className="mr-2 text-green-600" /> 浏览器要求
                                </h3>
                                <ul className="space-y-3 text-gray-700">
                                    <li>
                                        <strong>推荐浏览器：</strong>Chrome 浏览器
                                        <span className="ml-2 text-sm text-gray-500">(版本 113 及以上)</span>
                                    </li>
                                    <li>
                                        <strong>最低配置：</strong>16G 内存
                                    </li>
                                </ul>
                            </div>
                            <div className="bg-white p-6 rounded-lg shadow-md">
                                <h3 className="text-xl font-semibold mb-4 flex items-center">
                                    <Info className="mr-2 text-blue-600" /> WebGPU 支持
                                </h3>
                                <div className="mb-4">
                                    <Button
                                        onClick={() => {
                                            // 简单的WebGPU检测逻辑
                                            setIsWebGPUSupported('gpu' in navigator);
                                        }}
                                        variant="outline"
                                    >
                                        检测 WebGPU 支持
                                    </Button>
                                </div>
                                {isWebGPUSupported !== false && (
                                    <p className={`font-semibold ${isWebGPUSupported ? 'text-green-600' : 'text-gray-600'}`}>
                                        {isWebGPUSupported === true
                                            ? '✓ 您的浏览器支持 WebGPU'
                                            : '点击检测您的浏览器是否支持 WebGPU'}
                                    </p>
                                )}
                                {isWebGPUSupported === false && (
                                    <p className="text-red-600">
                                        × 您的浏览器不支持 WebGPU，建议升级 Chrome 浏览器
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* User Guidance Section */}
                <section className="container mx-auto px-4 py-16">
                    <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
                        <h2 className="text-3xl font-semibold mb-6 text-center">如何更好地使用系统</h2>
                        <div className="space-y-6 text-gray-700 leading-relaxed">
                            <div>
                                <h3 className="text-xl font-semibold mb-3">系统工作原理</h3>
                                <p>
                                    BeCurator 基于语义和关键词匹配技术。当您输入问题时，系统会智能地分析您的查询，并从知识库中检索最相关的信息。
                                </p>
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold mb-3">优化搜索建议</h3>
                                <ul className="list-disc pl-5 space-y-2">
                                    <li>
                                        如果初次搜索结果不满意，请尝试调整您的询问语句。
                                        例如，从具体的、详细的角度重新描述您的问题。
                                    </li>
                                    <li>
                                        使用更精确的关键词，避免过于宽泛或模糊的表述。
                                    </li>
                                    <li>
                                        必要时可以尝试使用不同的表达方式或同义词。
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold mb-3">提示</h3>
                                <p>
                                    系统的智能检索能力会随着您不断使用和优化查询而变得更加精准。保持耐心和探索的态度！
                                </p>
                            </div>
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