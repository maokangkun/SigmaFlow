import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Play, ChevronRight, ChevronDown, Star, Users, Zap, Brain, Workflow, Bot } from 'lucide-react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import './App.css'

// 导入图片素材
import multimodalImage from './assets/6nDsNZOTCKcd.webp'
import workflowImage from './assets/Hm9cNZrzavmM.png'
import agentsImage from './assets/evo6elZAIwt7.webp'
import agenticImage from './assets/PahVRft9OM4i.gif'
import videoPoster from './assets/video-poster.webp'

function App() {
  const [activeTab, setActiveTab] = useState('featured')
  const [language, setLanguage] = useState('zh-CN')
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false)
  const videoRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false);

  // 3D视频悬浮效果
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [15, -15]))
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-15, 15]))
  
  const handleMouseMove = (event) => {
    if (!videoRef.current) return
    const rect = videoRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    x.set((event.clientX - centerX) / rect.width)
    y.set((event.clientY - centerY) / rect.height)
  }
  
  const handleMouseLeave = () => {
    x.set(0)
    y.set(0)
  }

  const languages = {
    'zh-CN': {
      name: '简体中文',
      flag: '🇨🇳',
      content: {
        nav: {
          start: '开始使用',
          admin: '后台'
        },
        hero: {
          title: 'Leave it to SigmaFlow',
          subtitle: 'SigmaFlow 是一款革命性的多模态大模型工具，专注于构建智能化的 Agents 和 Workflow 系统。让复杂的AI任务变得简单，让创新想法快速落地。',
          experience: '体验 SigmaFlow',
          download: '下载应用程序'
        },
        useCases: {
          title: '用例',
          subtitle: '探索官方精选案例。',
          tabs: {
            featured: '精选',
            research: '研究',
            productivity: '生产力',
            dataAnalysis: '数据分析',
            automation: '自动化'
          },
          viewMore: '探索更多官方精选案例'
        },
        testimonials: {
          title: '各行业的声音',
          subtitle: '我们很高兴听到来自用户的反馈，尤其是那些正在塑造其行业的人们——这是他们分享的内容'
        },
        features: {
          title: '核心特性',
          multimodal: {
            title: '多模态大模型',
            description: '支持文本、图像、音频等多种模态的智能处理和生成'
          },
          agents: {
            title: '智能Agent系统',
            description: '构建可协作的智能Agent，实现复杂任务的自动化执行'
          },
          workflow: {
            title: '高效工作流',
            description: '可视化工作流设计，拖拽式构建复杂的AI处理管道'
          }
        },
        benchmark: {
          title: '基准测试',
          subtitle: 'SigmaFlow在多项基准测试中表现卓越，展现出强大的性能优势',
          metrics: {
            completion: '任务完成率',
            efficiency: '效率提升',
            accuracy: '准确率',
            response: '响应时间'
          },
          details: '详细测试结果',
          performance: '性能对比',
          agentEfficiency: 'Agent协作效率'
        }
      }
    },
    'en-US': {
      name: 'English',
      flag: '🇺🇸',
      content: {
        nav: {
          start: 'Get Started',
          admin: 'Admin'
        },
        hero: {
          title: 'Leave it to SigmaFlow',
          subtitle: 'SigmaFlow is a revolutionary multimodal large model tool focused on building intelligent Agents and Workflow systems. Making complex AI tasks simple and innovative ideas quickly realized.',
          experience: 'Experience SigmaFlow',
          download: 'Download App'
        },
        useCases: {
          title: 'Use Cases',
          subtitle: 'Explore official featured cases.',
          tabs: {
            featured: 'Featured',
            research: 'Research',
            productivity: 'Productivity',
            dataAnalysis: 'Data Analysis',
            automation: 'Automation'
          },
          viewMore: 'Explore More Official Cases'
        },
        testimonials: {
          title: 'Industry Voices',
          subtitle: 'We are delighted to hear feedback from our users, especially those who are shaping their industries - here is what they share'
        },
        features: {
          title: 'Core Features',
          multimodal: {
            title: 'Multimodal Large Model',
            description: 'Support intelligent processing and generation of multiple modalities including text, images, and audio'
          },
          agents: {
            title: 'Intelligent Agent System',
            description: 'Build collaborative intelligent Agents to achieve automated execution of complex tasks'
          },
          workflow: {
            title: 'Efficient Workflow',
            description: 'Visual workflow design, drag-and-drop construction of complex AI processing pipelines'
          }
        },
        benchmark: {
          title: 'Benchmarks',
          subtitle: 'SigmaFlow excels in multiple benchmark tests, demonstrating strong performance advantages',
          metrics: {
            completion: 'Task Completion Rate',
            efficiency: 'Efficiency Improvement',
            accuracy: 'Accuracy Rate',
            response: 'Response Time'
          },
          details: 'Detailed Test Results',
          performance: 'Performance Comparison',
          agentEfficiency: 'Agent Collaboration Efficiency'
        }
      }
    }
  }

  const t = languages[language].content

  const useCases = {
    featured: [
      {
        id: 1,
        title: "智能数据分析工作流",
        description: "SigmaFlow 自动构建多模态数据分析管道，处理文本、图像和音频数据，生成深度洞察报告。",
        category: "数据分析",
        image: multimodalImage
      },
      {
        id: 2,
        title: "多Agent协作系统",
        description: "构建智能Agent团队，实现复杂任务的自动化分解和协作执行，提升工作效率。",
        category: "协作",
        image: agentsImage
      },
      {
        id: 3,
        title: "自适应工作流引擎",
        description: "基于大模型的智能工作流，能够根据任务复杂度自动调整执行策略和资源分配。",
        category: "自动化",
        image: workflowImage
      },
      {
        id: 4,
        title: "多模态内容生成",
        description: "整合文本、图像、音频生成能力，创建丰富的多媒体内容和交互体验。",
        category: "内容创作",
        image: agenticImage
      }
    ],
    research: [
      {
        id: 5,
        title: "学术论文智能分析",
        description: "自动解析和分析学术论文，提取关键信息，生成研究综述和文献综述。",
        category: "学术研究",
        image: multimodalImage
      },
      {
        id: 6,
        title: "实验数据处理流水线",
        description: "构建自动化的实验数据处理管道，支持多种数据格式的清洗、分析和可视化。",
        category: "数据处理",
        image: workflowImage
      },
      {
        id: 7,
        title: "科研协作平台",
        description: "基于Agent的科研团队协作系统，实现研究任务的智能分配和进度跟踪。",
        category: "团队协作",
        image: agentsImage
      },
      {
        id: 8,
        title: "知识图谱构建",
        description: "从多模态数据中自动构建领域知识图谱，支持知识推理和问答系统。",
        category: "知识工程",
        image: multimodalImage
      }
    ],
    productivity: [
      {
        id: 9,
        title: "智能会议助手",
        description: "自动记录会议内容，生成会议纪要，分配任务并跟踪执行进度。",
        category: "办公效率",
        image: agentsImage
      },
      {
        id: 10,
        title: "文档自动化处理",
        description: "批量处理各类文档，实现格式转换、内容提取和智能分类。",
        category: "文档管理",
        image: workflowImage
      },
      {
        id: 11,
        title: "项目管理工作流",
        description: "构建智能项目管理系统，自动分配资源，预测项目风险和进度。",
        category: "项目管理",
        image: multimodalImage
      },
      {
        id: 12,
        title: "客户服务自动化",
        description: "多模态客户服务系统，支持文本、语音、图像的智能客服交互。",
        category: "客户服务",
        image: agentsImage
      }
    ],
    dataAnalysis: [
      {
        id: 13,
        title: "实时数据监控",
        description: "构建实时数据监控系统，自动检测异常并生成预警报告。",
        category: "监控预警",
        image: workflowImage
      },
      {
        id: 14,
        title: "预测分析模型",
        description: "基于历史数据构建预测模型，支持业务决策和趋势分析。",
        category: "预测分析",
        image: multimodalImage
      },
      {
        id: 15,
        title: "多维数据可视化",
        description: "自动生成多维数据的可视化图表，支持交互式数据探索。",
        category: "数据可视化",
        image: agentsImage
      },
      {
        id: 16,
        title: "商业智能报告",
        description: "自动生成商业智能报告，提供数据驱动的业务洞察和建议。",
        category: "商业智能",
        image: workflowImage
      }
    ],
    automation: [
      {
        id: 17,
        title: "RPA流程自动化",
        description: "构建智能RPA系统，自动化重复性业务流程，提升运营效率。",
        category: "流程自动化",
        image: workflowImage
      },
      {
        id: 18,
        title: "智能质量检测",
        description: "基于计算机视觉的自动化质量检测系统，提高产品质量控制。",
        category: "质量控制",
        image: multimodalImage
      },
      {
        id: 19,
        title: "供应链优化",
        description: "智能供应链管理系统，优化库存、物流和采购决策。",
        category: "供应链",
        image: agentsImage
      },
      {
        id: 20,
        title: "设备维护预测",
        description: "基于IoT数据的设备维护预测系统，降低设备故障率。",
        category: "设备维护",
        image: workflowImage
      }
    ]
  }

  const testimonials = [
    {
      name: "张伟",
      role: "AI研究员 @ 清华大学",
      content: "SigmaFlow让我们的多模态研究项目效率提升了300%。它的Agent协作机制特别适合复杂的学术研究场景。",
      avatar: "👨‍🔬"
    },
    {
      name: "李小雨",
      role: "产品经理 @ 字节跳动",
      content: "使用SigmaFlow构建的工作流让我们的产品开发周期缩短了一半。多模态能力让用户体验更加丰富。",
      avatar: "👩‍💼"
    },
    {
      name: "王建国",
      role: "CTO @ 创新科技",
      content: "SigmaFlow的Agent系统帮助我们实现了真正的智能化运营。从数据处理到决策制定，全程自动化。",
      avatar: "👨‍💻"
    },
    {
      name: "陈思雨",
      role: "数据科学家 @ 腾讯",
      content: "多模态数据处理从未如此简单。SigmaFlow让我们能够轻松整合文本、图像和音频数据，构建强大的AI应用。",
      avatar: "👩‍🔬"
    },
    {
      name: "刘明华",
      role: "技术总监 @ 阿里巴巴",
      content: "SigmaFlow的工作流引擎极大地提升了我们的开发效率。复杂的AI任务现在可以通过可视化界面轻松配置。",
      avatar: "👨‍💼"
    },
    {
      name: "赵雅琳",
      role: "AI工程师 @ 百度",
      content: "Agent协作功能让我们的团队能够构建更加智能和自主的系统。SigmaFlow真正实现了AI的协同工作。",
      avatar: "👩‍💻"
    },
    {
      name: "孙志强",
      role: "研发经理 @ 华为",
      content: "从原型到生产，SigmaFlow提供了完整的解决方案。它的多模态能力为我们的产品创新提供了无限可能。",
      avatar: "👨‍🔧"
    },
    {
      name: "周美玲",
      role: "AI产品经理 @ 小米",
      content: "SigmaFlow的用户界面设计非常直观，即使是非技术人员也能快速上手。这大大降低了AI应用的门槛。",
      avatar: "👩‍🎨"
    }
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* 导航栏 */}
      <nav className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center">
            {/* <Workflow className="w-5 h-5 text-white" /> */}
            <svg t="1770198307635" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1555" width="200" height="200"><path d="M0 0h440.32v102.4H0z m583.68 0H1024v102.4H583.68zM0 184.32h1024v102.4H0zM0 368.64h440.32v102.4H0z m583.68 0H1024v102.4H583.68zM0 552.96h1024v102.4H0zM0 737.28h440.32v102.4H0z m583.68 0H1024v102.4H583.68zM0 921.6h1024V1024H0z" p-id="1556"></path></svg>
          </div>
          <span className="text-xl font-bold">SigmaFlow</span>
        </div>
        <div className="flex items-center space-x-4">
          <div className="relative">
            <button
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
              onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
            >
              <span>{languages[language].flag}</span>
              <span>{languages[language].name}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {showLanguageDropdown && (
              <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-[140px]">
                {Object.entries(languages).map(([code, lang]) => (
                  <button
                    key={code}
                    className="w-full flex items-center space-x-2 px-3 py-2 text-sm hover:bg-gray-50 text-left"
                    onClick={() => {
                      setLanguage(code)
                      setShowLanguageDropdown(false)
                    }}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            className="bg-gray-900 hover:bg-gray-700"
            onClick={() => (window.location.href = "/workspace/")}
          >
            {t.nav.start}
          </Button>
          <Button
            className="bg-gray-900 hover:bg-gray-700"
            onClick={() => window.open("/admin/", "_blank")}
          >
            {t.nav.admin}
          </Button>
        </div>
      </nav>

      {/* 主视觉区域 */}
      <section className="px-6 py-20 text-center">
        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent" style={{lineHeight: '1.5'}}>
          {t.hero.title}
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
          {t.hero.subtitle}
        </p>
        <div className="flex justify-center space-x-4 mb-12">
          <Button size="lg"
            className="bg-gray-900 hover:bg-gray-800 px-8 py-3"
            onClick={() => (window.location.href = "/workspace/")}
          >
            {t.hero.experience}
          </Button>
          <Button size="lg" variant="outline" className="px-8 py-3 border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white">
            {t.hero.download}
          </Button>
        </div>

        {/* 视频展示区域 */}
        <div className="max-w-5xl mx-auto">
          <motion.div 
            ref={videoRef}
            className="relative rounded-2xl shadow-2xl cursor-pointer overflow-hidden"
            style={{
              rotateX,
              rotateY,
              transformStyle: "preserve-3d",
            }}
            whileHover={{ 
              scale: 1.02,
              y: -10,
              transition: { duration: 0.3 }
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <div className="relative bg-black rounded-2xl overflow-hidden">
              <video
                className="w-full h-full object-cover rounded-2xl"
                poster={videoPoster}
                controls
                preload="metadata"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              >
                {/* <source src="https://files.manuscdn.com/assets/video/Manus-Chinese-2k-compressed-v2.mp4" type="video/mp4" /> */}
                <source src="https://resource2.heygen.ai/video/transcode/1c3cd271ad9f40ff9895c9da011fa482/v344cac8c4c754c1097f9e6878d14c38f/1280x720.mp4?response-content-disposition=attachment%3B+filename%2A%3DUTF-8%27%27SigmaFlow%2520Promo.mp4%3B" type="video/mp4" />
                您的浏览器不支持视频播放。
              </video>
              {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-white text-4xl">
                  <h3 className="font-semibold mb-2">
                    Introducing SigmaFlow
                  </h3>
                  <p className="text-gray-200 text-lg">
                    了解如何使用多模态AI构建智能工作流
                  </p>
                </div>
              </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* 用例展示 */}
      <section className="px-6 py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">{t.useCases.title}</h2>
          <p className="text-xl text-gray-600 text-center mb-12">
            {t.useCases.subtitle}
          </p>

          {/* 标签切换 */}
          <div className="flex justify-center mb-8">
            <div className="flex space-x-2 bg-white rounded-lg p-1 shadow-sm">
              {[
                { key: 'featured', label: t.useCases.tabs.featured },
                { key: 'research', label: t.useCases.tabs.research },
                { key: 'productivity', label: t.useCases.tabs.productivity },
                { key: 'dataAnalysis', label: t.useCases.tabs.dataAnalysis },
                { key: 'automation', label: t.useCases.tabs.automation }
              ].map((tab) => (
                <button
                  key={tab.key}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeTab === tab.key 
                      ? 'bg-gray-900 text-white' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 用例卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {useCases[activeTab]?.map((useCase) => (
              <Card key={useCase.id} className="group hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader className="p-0">
                  <div className="h-48 bg-gradient-to-br from-gray-100 to-gray-200 rounded-t-lg flex items-center justify-center overflow-hidden">
                    <img 
                      src={useCase.image} 
                      alt={useCase.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <Badge variant="secondary" className="mb-2 text-xs">
                    {useCase.category}
                  </Badge>
                  <CardTitle className="text-lg mb-2 group-hover:text-gray-900 transition-colors">
                    {useCase.title}
                  </CardTitle>
                  <CardDescription className="text-sm text-gray-600 mb-4">
                    {useCase.description}
                  </CardDescription>
                  <Button variant="ghost" size="sm" className="p-0 h-auto text-gray-900 hover:text-gray-700">
                    查看回放 <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-12">
            <Button variant="outline" size="lg" className="border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white">
              {t.useCases.viewMore}
            </Button>
          </div>
        </div>
      </section>

      {/* 用户评价 */}
      <section className="px-6 py-16 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">{t.testimonials.title}</h2>
          <p className="text-xl text-gray-600 text-center mb-12 max-w-4xl mx-auto">
            {t.testimonials.subtitle}
          </p>

          {/* 跑马灯容器 */}
          <div className="relative">
            <motion.div
              className="flex space-x-6"
              animate={{
                x: [0, -100 * testimonials.length]
              }}
              transition={{
                x: {
                  repeat: Infinity,
                  repeatType: "loop",
                  duration: testimonials.length * 8,
                  ease: "linear",
                },
              }}
              style={{ width: `${testimonials.length * 400 + (testimonials.length - 1) * 24}px` }}
            >
              {/* 渲染两遍评价卡片以实现无缝循环 */}
              {[...testimonials, ...testimonials].map((testimonial, index) => (
                <motion.div
                  key={index}
                  className="flex-shrink-0 w-96"
                  whileHover={{ 
                    scale: 1.05,
                    y: -5,
                    transition: { duration: 0.2 }
                  }}
                >
                  <Card className="h-full bg-gradient-to-br from-white to-gray-50 border-2 border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300">
                    <CardContent className="p-6">
                      <div className="flex items-center mb-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-100 to-indigo-200 rounded-full flex items-center justify-center text-2xl mr-4 shadow-md">
                          {testimonial.avatar}
                        </div>
                        <div>
                          <h4 className="font-bold text-lg text-gray-900">{testimonial.name}</h4>
                          <p className="text-sm text-blue-600 font-medium">{testimonial.role}</p>
                        </div>
                      </div>
                      <p className="text-gray-700 leading-relaxed mb-4 text-sm">
                        "{testimonial.content}"
                      </p>
                      <div className="flex">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
            
            {/* 渐变遮罩 */}
            <div className="absolute top-0 left-0 w-20 h-full bg-gradient-to-r from-white to-transparent z-10 pointer-events-none"></div>
            <div className="absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-white to-transparent z-10 pointer-events-none"></div>
          </div>
        </div>
      </section>

      {/* 特性展示 */}
      <section className="px-6 py-16 bg-gray-100">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900">{t.features.title}</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">{t.features.multimodal.title}</h3>
              <p className="text-gray-600">
                {t.features.multimodal.description}
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">{t.features.agents.title}</h3>
              <p className="text-gray-600">
                {t.features.agents.description}
              </p>
            </div>
            
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">{t.features.workflow.title}</h3>
              <p className="text-gray-600">
                {t.features.workflow.description}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 基准测试板块 */}
      <section className="px-6 py-16 bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4 text-gray-900">{t.benchmark.title}</h2>
          <p className="text-xl text-gray-600 text-center mb-12">
            {t.benchmark.subtitle}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {/* 性能指标卡片 */}
            <Card className="text-center p-6 bg-gray-50 border-gray-200">
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-gray-900 mb-2">98.7%</div>
                <h4 className="font-semibold text-gray-900 mb-1">{t.benchmark.metrics.completion}</h4>
                <p className="text-sm text-gray-600">在复杂多模态任务中的成功率</p>
              </CardContent>
            </Card>

            <Card className="text-center p-6 bg-gray-100 border-gray-200">
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-gray-900 mb-2">3.2x</div>
                <h4 className="font-semibold text-gray-900 mb-1">{t.benchmark.metrics.efficiency}</h4>
                <p className="text-sm text-gray-600">相比传统方法的处理速度提升</p>
              </CardContent>
            </Card>

            <Card className="text-center p-6 bg-gray-200 border-gray-300">
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-gray-900 mb-2">95.3%</div>
                <h4 className="font-semibold text-gray-900 mb-1">{t.benchmark.metrics.accuracy}</h4>
                <p className="text-sm text-gray-600">多模态理解和生成的准确率</p>
              </CardContent>
            </Card>

            <Card className="text-center p-6 bg-gray-300 border-gray-400">
              <CardContent className="p-0">
                <div className="text-3xl font-bold text-gray-900 mb-2">50ms</div>
                <h4 className="font-semibold text-gray-900 mb-1">{t.benchmark.metrics.response}</h4>
                <p className="text-sm text-gray-600">平均API响应时间</p>
              </CardContent>
            </Card>
          </div>

          {/* 详细基准测试结果 */}
          <div className="bg-gray-50 rounded-2xl shadow-lg p-8 border border-gray-200">
            <h3 className="text-2xl font-bold text-center mb-8 text-gray-900">{t.benchmark.details}</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 左侧：性能对比图片 */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-900">{t.benchmark.performance}</h4>
                <div className="bg-white rounded-lg p-4 border border-gray-200">
                  <img 
                    src="https://cdn.baichuan-ai.com/build/_next/static/media/arc.23ccb0a7.png" 
                    alt="Performance Comparison"
                    className="w-full h-auto rounded-lg"
                  />
                </div>
              </div>

              {/* 右侧：Agent协作效率 */}
              <div>
                <h4 className="text-lg font-semibold mb-4 text-gray-900">{t.benchmark.agentEfficiency}</h4>
                <div className="space-y-4">
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900">任务分解能力</span>
                      <span className="text-gray-900 font-bold">96.2%</span>
                    </div>
                    <p className="text-sm text-gray-600">复杂任务自动分解的准确率</p>
                  </div>
                  
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900">协作效率</span>
                      <span className="text-gray-900 font-bold">4.1x</span>
                    </div>
                    <p className="text-sm text-gray-600">多Agent协作相比单Agent的效率提升</p>
                  </div>
                  
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900">资源利用率</span>
                      <span className="text-gray-900 font-bold">91.8%</span>
                    </div>
                    <p className="text-sm text-gray-600">计算资源的有效利用率</p>
                  </div>
                  
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900">扩展性</span>
                      <span className="text-gray-900 font-bold">1000+</span>
                    </div>
                    <p className="text-sm text-gray-600">支持的并发Agent数量</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="px-6 py-12 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <Workflow className="w-5 h-5 text-gray-900" />
            </div>
            <span className="text-xl font-bold">SigmaFlow</span>
          </div>
          <p className="text-gray-400 mb-8">
            让AI工作流变得简单而强大
          </p>
          <div className="flex justify-center space-x-8 text-sm text-gray-400">
            <a href="#" className="hover:text-white transition-colors">关于我们</a>
            <a href="#" className="hover:text-white transition-colors">产品文档</a>
            <a href="#" className="hover:text-white transition-colors">开发者API</a>
            <a href="#" className="hover:text-white transition-colors">联系我们</a>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-sm text-gray-500">
            © 2025 SigmaFlow. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}

export default App

