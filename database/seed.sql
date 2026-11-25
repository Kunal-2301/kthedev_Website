-- =============================================================================
-- Initial content, sourced from Kunal_Gupta_Resume.pdf and the project brief.
-- Nothing here is invented: unknown links are left NULL, metrics are only the
-- ones stated on the resume. Re-running is safe (conflicts are ignored).
-- Skill levels are a conservative starting point — review them in /admin.
-- =============================================================================

insert into public.profiles (id, full_name, handle, tagline, designation, hero_headline, hero_description, intro, about_md, focus_areas, location,
                             email, phone, github_url, linkedin_url, footer_text, seo_title, seo_description)
values (1,
  'Kunal Gupta',
  'kthedev',
  'GenAI · Agentic AI · RAG · Python Backend',
  'Python Backend Developer | AI Engineer',
  'Engineering Intelligent Systems. Building the Future with AI.',
  'Python Backend Developer & AI Engineer specializing in Generative AI, Agentic Systems, RAG and production-ready AI applications.',
  'I''m Kunal — a Computer Science graduate from Amity University Noida who builds backend systems and AI applications, from model training to deployment.',
  $md$I completed my **B.Tech in Computer Science and Engineering** at Amity University Noida (2022–2026), where my work gravitated toward machine learning, computer vision and, increasingly, large language models.

My hands-on work spans the full lifecycle of AI systems:

- **Deep learning & computer vision** — I designed a custom CNN for multi-class skin-lesion classification and fine-tuned YOLOv8 on a custom annotated dataset, serving inference through a Flask application.
- **LLM applications** — I built a retrieval-augmented chatbot over user-uploaded PDFs with LangChain, covering parsing, chunking, embeddings and semantic retrieval.
- **Production software** — I built and deployed a manufacturing ERP covering inventory, purchasing, dispatch, billing and payroll, running in production with 1,400+ automated tests in CI.

During my internship at **HCLTech** as an AI Infrastructure & Cloud Analyst, I modelled total cost of ownership for AI model deployments and benchmarked deployment configurations for enterprise inference workloads — which shaped how I think about AI systems beyond the notebook: cost, scalability and operations.

Today my focus is **Python backend engineering and applied AI**: FastAPI services, Generative and Agentic AI, advanced RAG, LLM evaluation and the infrastructure needed to run AI reliably in production.$md$,
  array['Generative AI', 'Agentic AI', 'LLM Engineering', 'Advanced RAG', 'Python Backend Development', 'FastAPI',
        'Machine Learning', 'Deep Learning', 'AI Application Development', 'AI Infrastructure & Deployment'],
  'Faridabad, Haryana, India',
  'kunalguptag11@gmail.com',
  '+91 96253 22563',
  'https://github.com/Kunal-2301',
  'https://linkedin.com/in/kunal977',
  'Designed and engineered by Kunal Gupta.',
  'Kunal Gupta — Python Backend Developer & AI Engineer',
  'Portfolio of Kunal Gupta, a Python Backend Developer and AI Engineer working on Generative AI, Agentic AI, RAG, deep learning and production-ready AI applications.')
on conflict (id) do nothing;

insert into public.site_settings (id, site_title, meta_description, keywords, theme_default, contact_email, contact_phone)
values (1,
  'Kunal Gupta — Python Backend Developer & AI Engineer',
  'Portfolio of Kunal Gupta, a Python Backend Developer and AI Engineer working on Generative AI, Agentic AI, RAG, deep learning and production-ready AI applications.',
  'Kunal Gupta, AI Engineer, Python Backend Developer, Generative AI, Agentic AI, RAG, LangChain, FastAPI, Machine Learning',
  'light',
  'kunalguptag11@gmail.com',
  '+91 96253 22563')
on conflict (id) do nothing;

-- Navigation -------------------------------------------------------------------
insert into public.nav_items (location, label, target_type, section_key, url, icon, sort_order)
select * from (values
  ('header', 'About',       'section', 'about',       null, null, 1),
  ('header', 'Projects',    'section', 'projects',    null, null, 2),
  ('header', 'Skills',      'section', 'skills',      null, null, 3),
  ('header', 'Experience',  'section', 'experience',  null, null, 4),
  ('header', 'Education',   'section', 'education',   null, null, 5),
  ('header', 'Contact',     'section', 'contact',     null, null, 6),
  ('social', 'GitHub',      'url', null, 'https://github.com/Kunal-2301',      'github',   1),
  ('social', 'LinkedIn',    'url', null, 'https://linkedin.com/in/kunal977',   'linkedin', 2),
  ('social', 'Email',       'url', null, 'mailto:kunalguptag11@gmail.com',     'email',    3),
  ('footer', 'About',       'section', 'about',       null, null, 1),
  ('footer', 'Projects',    'section', 'projects',    null, null, 2),
  ('footer', 'Skills',      'section', 'skills',      null, null, 3),
  ('footer', 'Contact',     'section', 'contact',     null, null, 4)
) v(location, label, target_type, section_key, url, icon, sort_order)
where not exists (select 1 from public.nav_items);

-- Skill categories ---------------------------------------------------------------
insert into public.skill_categories (name, slug, description, sort_order) values
  ('Programming',         'programming',        'Languages I write software in.', 1),
  ('Backend',             'backend',            'APIs, services, authentication and data access.', 2),
  ('Generative AI',       'genai',              'LLM application frameworks, providers and techniques.', 3),
  ('Advanced RAG',        'advanced-rag',       'Retrieval pipelines for grounded LLM answers.', 4),
  ('Vector Databases',    'vector-databases',   'Similarity search stores for embeddings.', 5),
  ('Agentic AI',          'agentic-ai',         'Agents, tools, orchestration and protocols.', 6),
  ('LLM Evaluation',      'llm-evaluation',     'Measuring LLM and RAG quality.', 7),
  ('AI Security',         'ai-security',        'Guardrails and defenses for LLM systems.', 8),
  ('LLM Infrastructure',  'llm-infrastructure', 'Serving, routing and operating models.', 9),
  ('Machine Learning',    'machine-learning',   'Classical ML workflow and tooling.', 10),
  ('Deep Learning',       'deep-learning',      'Neural networks and computer vision.', 11),
  ('Data Science',        'data-science',       'Analysis, statistics and visualization.', 12),
  ('Databases',           'databases',          'Relational databases.', 13),
  ('DevOps',              'devops',             'Containers, version control, CI/CD and deployment.', 14),
  ('Cloud',               'cloud',              'Cloud platforms.', 15),
  ('Monitoring',          'monitoring',         'Observability for services and models.', 16),
  ('Application Development', 'app-development', 'Front-end and full-stack application tooling.', 17)
on conflict (slug) do nothing;

-- Skills (level: experienced = used in projects/internship per resume) -----------
insert into public.skills (category_id, name, level, sort_order)
select c.id, s.name, s.level, s.ord
from (values
  ('programming','Python','experienced',1), ('programming','C++','familiar',2), ('programming','Java','familiar',3),
  ('programming','JavaScript','experienced',4), ('programming','SQL','experienced',5),

  ('backend','FastAPI','familiar',1), ('backend','Flask','experienced',2), ('backend','Pydantic','familiar',3),
  ('backend','SQLAlchemy','exploring',4), ('backend','Alembic','exploring',5), ('backend','AsyncIO','familiar',6),
  ('backend','REST APIs','experienced',7), ('backend','JWT','familiar',8), ('backend','OAuth 2.0','exploring',9),
  ('backend','OpenID Connect','exploring',10), ('backend','RBAC','experienced',11),

  ('genai','LangChain','experienced',1), ('genai','LangGraph','exploring',2), ('genai','LangSmith','exploring',3),
  ('genai','Hugging Face','experienced',4), ('genai','OpenAI APIs','familiar',5), ('genai','Gemini APIs','familiar',6),
  ('genai','Prompt Engineering','familiar',7), ('genai','Structured Outputs','exploring',8),
  ('genai','Function Calling','exploring',9), ('genai','Claude Code','experienced',10),

  ('advanced-rag','Embeddings','experienced',1), ('advanced-rag','Semantic Search','experienced',2),
  ('advanced-rag','Document Loaders','experienced',3), ('advanced-rag','Hybrid Search','exploring',4),
  ('advanced-rag','Reranking','exploring',5), ('advanced-rag','Query Transformation','exploring',6),
  ('advanced-rag','GraphRAG','exploring',7), ('advanced-rag','Multimodal RAG','exploring',8),

  ('vector-databases','FAISS','exploring',1), ('vector-databases','ChromaDB','exploring',2),
  ('vector-databases','Qdrant','exploring',3), ('vector-databases','Pinecone','exploring',4),
  ('vector-databases','pgvector','exploring',5),

  ('agentic-ai','Multi-Agent Systems','exploring',1), ('agentic-ai','MCP','exploring',2), ('agentic-ai','FastMCP','exploring',3),
  ('agentic-ai','Tool Calling','exploring',4), ('agentic-ai','Human-in-the-Loop','exploring',5),
  ('agentic-ai','Agent Orchestration','exploring',6), ('agentic-ai','n8n','exploring',7),

  ('llm-evaluation','Ragas','exploring',1), ('llm-evaluation','DeepEval','exploring',2), ('llm-evaluation','Promptfoo','exploring',3),
  ('llm-evaluation','LLM-as-a-Judge','exploring',4), ('llm-evaluation','RAG Evaluation','exploring',5),

  ('ai-security','Prompt Injection Defense','exploring',1), ('ai-security','PII Protection','exploring',2),
  ('ai-security','OWASP LLM Top 10','exploring',3), ('ai-security','Guardrails AI','exploring',4),
  ('ai-security','NeMo Guardrails','exploring',5),

  ('llm-infrastructure','LiteLLM','exploring',1), ('llm-infrastructure','vLLM','exploring',2), ('llm-infrastructure','Ollama','exploring',3),
  ('llm-infrastructure','LLM Gateway','exploring',4), ('llm-infrastructure','Model Routing','exploring',5),
  ('llm-infrastructure','Cost Monitoring','familiar',6),

  ('machine-learning','Scikit-learn','experienced',1), ('machine-learning','Feature Engineering','familiar',2),
  ('machine-learning','MLflow','exploring',3), ('machine-learning','Model Training','experienced',4),
  ('machine-learning','Model Evaluation','experienced',5),

  ('deep-learning','TensorFlow','experienced',1), ('deep-learning','Keras','experienced',2), ('deep-learning','PyTorch','exploring',3),
  ('deep-learning','CNN','experienced',4), ('deep-learning','RNN','familiar',5), ('deep-learning','LSTM','familiar',6),
  ('deep-learning','GRU','familiar',7), ('deep-learning','Transformers','familiar',8), ('deep-learning','YOLOv8','experienced',9),
  ('deep-learning','OpenCV','experienced',10), ('deep-learning','Transfer Learning','experienced',11),

  ('data-science','NumPy','experienced',1), ('data-science','Pandas','experienced',2), ('data-science','Matplotlib','experienced',3),
  ('data-science','Seaborn','experienced',4), ('data-science','Statistics','familiar',5), ('data-science','EDA','experienced',6),

  ('databases','PostgreSQL','familiar',1), ('databases','MySQL','familiar',2), ('databases','SQLite','experienced',3),

  ('devops','Docker','familiar',1), ('devops','Docker Compose','exploring',2), ('devops','Git','experienced',3),
  ('devops','GitHub','experienced',4), ('devops','GitHub Actions','experienced',5), ('devops','CI/CD','experienced',6),
  ('devops','Cloudflare Tunnel','experienced',7),

  ('cloud','AWS','familiar',1), ('cloud','GCP','familiar',2), ('cloud','Azure Fundamentals','familiar',3),

  ('monitoring','OpenTelemetry','exploring',1), ('monitoring','Prometheus','exploring',2), ('monitoring','Grafana','exploring',3),

  ('app-development','Streamlit','experienced',1), ('app-development','HTML','experienced',2), ('app-development','CSS','experienced',3),
  ('app-development','Node.js','experienced',4), ('app-development','Express','experienced',5)
) s(cat, name, level, ord)
join public.skill_categories c on c.slug = s.cat
on conflict do nothing;

-- Projects ------------------------------------------------------------------------
insert into public.projects (slug, title, short_description, description_md, problem_md, solution_md, implementation_md,
  key_features, category, project_status, github_url, demo_url, metrics, is_featured, sort_order, status, seo_description)
values
('skin-lesion-classification', 'Skin Lesion Classification',
 'A custom CNN in TensorFlow/Keras for multi-class classification of dermatoscopic skin-lesion images.',
 $md$A deep-learning project that classifies dermatoscopic images of skin lesions into multiple classes using a convolutional neural network designed from scratch in TensorFlow/Keras.$md$,
 $md$Dermatoscopic images vary in lighting, scale and quality, and visually similar lesion types make multi-class classification difficult for simple baseline models.$md$,
 $md$A custom CNN architecture with a complete training, validation and evaluation pipeline, with metric analysis to compare against the baseline models evaluated.$md$,
 $md$- Image preprocessing with **OpenCV**
- Custom **CNN** architecture built with **TensorFlow/Keras**
- Training, validation and evaluation pipeline with **NumPy**
- Metric analysis and visualization with **Matplotlib**$md$,
 array['Custom CNN architecture', 'Multi-class classification', 'End-to-end training and evaluation pipeline', 'Metric analysis against baseline models'],
 'Deep Learning', 'completed', 'https://github.com/Kunal-2301/Skin-Lesion-Classification', null,
 '[{"label":"Accuracy","value":"94%","description":"Reported overall accuracy, outperforming the baseline models evaluated."}]',
 true, 1, 'published',
 'Custom CNN for multi-class skin lesion classification with TensorFlow/Keras and OpenCV — 94% reported accuracy.'),

('document-qa-chatbot', 'AI-Powered Document Q&A Chatbot',
 'A retrieval-augmented chatbot that answers natural-language questions over user-uploaded PDF documents.',
 $md$A Retrieval-Augmented Generation (RAG) application: upload PDFs, ask questions in natural language, and get answers grounded in the documents' content through an interactive Streamlit interface.$md$,
 $md$Finding specific information across long PDF documents means slow, manual searching and reading.$md$,
 $md$A RAG pipeline that ingests PDFs, splits them into chunks, embeds them and retrieves the most relevant passages to answer each query — reducing manual document lookup to a single question.$md$,
 $md$1. **PDF ingestion** — parse user-uploaded documents
2. **Text chunking** — split content into retrievable passages
3. **Embeddings** — encode chunks for semantic similarity
4. **Semantic retrieval** — select relevant context for each question
5. **Answer generation** — LLM response grounded in retrieved context (LangChain)
6. **Interface** — interactive Streamlit app$md$,
 array['PDF upload and parsing', 'Text chunking', 'Embedding-based semantic retrieval', 'Retrieval-augmented answers', 'Interactive Streamlit interface'],
 'Generative AI', 'completed', 'https://github.com/Kunal-2301/ChatWithPDF', null, '[]',
 true, 2, 'published',
 'RAG chatbot over uploaded PDFs with LangChain, embeddings, semantic retrieval and Streamlit.'),

('yolov8-smoke-cigarette-detection', 'YOLOv8 Smoke & Cigarette Detection',
 'A fine-tuned YOLOv8 object-detection model that identifies cigarettes and smoke-related objects, served through Flask.',
 $md$An object-detection system built by fine-tuning YOLOv8 on a custom annotated dataset, with inference exposed through a Flask web application.$md$,
 $md$Detecting small objects such as cigarettes, and diffuse patterns such as smoke, requires a detector trained on representative, well-annotated data.$md$,
 $md$A custom annotated dataset, a YOLOv8 fine-tuning and augmentation loop in Python/OpenCV, and a Flask application for serving inference.$md$,
 $md$- Custom dataset annotation
- **YOLOv8** fine-tuning with data augmentation
- Training loop in **Python** and **OpenCV**
- Inference served through a **Flask** web application$md$,
 array['Custom annotated dataset', 'YOLOv8 fine-tuning with augmentation', 'Flask inference web app'],
 'Computer Vision', 'completed', 'https://github.com/Kunal-2301/smoker_classification', null,
 '[{"label":"Detection accuracy","value":"92%","description":"Reported on the held-out test set."}]',
 true, 3, 'published',
 'YOLOv8 object detection for cigarettes and smoke, fine-tuned on a custom dataset and served with Flask — 92% reported accuracy.'),

('manufacturing-erp-system', 'Manufacturing ERP System',
 'A production ERP for a manufacturing factory covering inventory, purchasing, dispatch, billing and payroll.',
 $md$A full-stack ERP built for a manufacturing business, replacing Excel-based workflows with role-based modules for multiple business units. Built with AI-assisted development (Claude Code) and running in production.$md$,
 $md$Factory operations across several business units were managed through Excel workflows, making inventory, purchasing, dispatch, billing and payroll hard to coordinate and audit.$md$,
 $md$Requirements were gathered directly from factory staff and turned into role-based ERP modules, deployed to production and improved iteratively from daily user feedback.$md$,
 $md$- **Node.js** and **Express** backend with **SQLite**
- Role-based modules for multiple business units
- Production deployment via **nssm** and **Cloudflare Tunnel**
- **1,400+ automated tests** running in CI with **GitHub Actions**$md$,
 array['Inventory management', 'Purchasing', 'Dispatch', 'Billing', 'Payroll', 'Role-based access per business unit'],
 'Full-Stack', 'maintained', null, 'https://erp.guptagroups.in/',
 '[{"label":"Automated tests","value":"1,400+","description":"Automated tests running in CI."}]',
 true, 4, 'published',
 'Production ERP for a manufacturing factory with Node.js, Express and SQLite — inventory, purchasing, dispatch, billing, payroll and 1,400+ CI tests.')
on conflict (slug) do nothing;

insert into public.project_technologies (project_id, skill_id, sort_order)
select p.id, s.id, t.ord
from (values
  ('skin-lesion-classification', 'Python', 1), ('skin-lesion-classification', 'TensorFlow', 2),
  ('skin-lesion-classification', 'Keras', 3), ('skin-lesion-classification', 'CNN', 4),
  ('skin-lesion-classification', 'OpenCV', 5), ('skin-lesion-classification', 'NumPy', 6),
  ('skin-lesion-classification', 'Matplotlib', 7),
  ('document-qa-chatbot', 'Python', 1), ('document-qa-chatbot', 'LangChain', 2), ('document-qa-chatbot', 'Streamlit', 3),
  ('document-qa-chatbot', 'Embeddings', 4), ('document-qa-chatbot', 'Semantic Search', 5),
  ('document-qa-chatbot', 'Document Loaders', 6), ('document-qa-chatbot', 'HTML', 7),
  ('yolov8-smoke-cigarette-detection', 'Python', 1), ('yolov8-smoke-cigarette-detection', 'YOLOv8', 2),
  ('yolov8-smoke-cigarette-detection', 'OpenCV', 3), ('yolov8-smoke-cigarette-detection', 'Flask', 4),
  ('manufacturing-erp-system', 'Node.js', 1), ('manufacturing-erp-system', 'Express', 2),
  ('manufacturing-erp-system', 'SQLite', 3), ('manufacturing-erp-system', 'GitHub Actions', 4),
  ('manufacturing-erp-system', 'RBAC', 5), ('manufacturing-erp-system', 'Cloudflare Tunnel', 6),
  ('manufacturing-erp-system', 'Claude Code', 7)
) t(slug, skill, ord)
join public.projects p on p.slug = t.slug
join public.skills s on lower(s.name) = lower(t.skill)
on conflict do nothing;

-- Experience --------------------------------------------------------------------
insert into public.experience (company, role_title, employment_type, location, start_date, end_date, is_current,
                               date_precision, responsibilities, sort_order, status)
select * from (values
  ('HCLTech', 'AI Infrastructure & Cloud Analyst Intern', 'internship', null::text, date '2025-05-01', date '2025-07-31', false, 'month',
   array['Modelled total cost of ownership for AI model deployments using AMD''s TCO tooling, informing enterprise cost-efficiency decisions.',
         'Contributed to AMD–HCLTech AI solution design on VMware VCF and IBM Watsonx, evaluating scalability for enterprise inference workloads.',
         'Benchmarked 5+ model deployment configurations and documented TCO comparisons used to guide enterprise infrastructure cost decisions.'],
   1, 'published'::public.content_status),
  ('NEC E-CELL, ASET (Amity University)', 'Technical Head', 'leadership', 'Noida', date '2024-01-01', null::date, true, 'year',
   array[]::text[], 2, 'published'::public.content_status),
  ('Coding Ninjas Club, Amity University', 'Tech Core Team Member', 'leadership', 'Noida', date '2024-01-01', null::date, true, 'year',
   array[]::text[], 3, 'published'::public.content_status)
) v
where not exists (select 1 from public.experience);

-- Education ---------------------------------------------------------------------
insert into public.education (institution, degree, field, location, start_year, end_year, grade, sort_order, status)
select * from (values
  ('Amity University Noida', 'B.Tech', 'Computer Science and Engineering', 'Noida, Uttar Pradesh', 2022, 2026, 'CGPA 7.90', 1, 'published'::public.content_status),
  ('DAV Public School, Faridabad', 'Class XII (CBSE)', null, 'Faridabad', null, 2022, '85%', 2, 'draft'::public.content_status),
  ('DAV Public School, Faridabad', 'Class X (CBSE)', null, 'Faridabad', null, 2020, '88%', 3, 'draft'::public.content_status)
) v
where not exists (select 1 from public.education);

-- Certifications -----------------------------------------------------------------
insert into public.certifications (name, issuer, issue_date, verify_url, sort_order, status)
select * from (values
  ('AWS Academy Cloud Foundations', 'Amazon Web Services', date '2025-03-01',
   'https://drive.google.com/file/d/1O7xdxbYJF5lsfz9xW9OAEDI_hCF3QxaT/view?usp=sharing', 1, 'published'::public.content_status),
  ('CCNA: Introduction to Networks', 'Cisco', date '2024-12-01', null, 2, 'published'::public.content_status),
  ('Google GenAI Study Jams', 'Google Cloud', date '2024-11-01',
   'https://drive.google.com/file/d/1FtISeTlPbF-DgnfCoq2243btvdnRygVx/view?usp=sharing', 3, 'published'::public.content_status),
  ('Microsoft Fundamentals of Machine Learning', 'Microsoft', date '2024-09-01',
   'https://drive.google.com/file/d/1qLbX_FagU3dKB6kLP0Ygel7Jbp8DIbWK/view?usp=sharing', 4, 'published'::public.content_status),
  ('NPTEL: Python for Data Science', 'IIT (NPTEL)', date '2024-02-01',
   'https://drive.google.com/file/d/1gQ5Re9o0vOSXkGgaNXqQnY37H5sd3hxi/view?usp=sharing', 5, 'published'::public.content_status)
) v
where not exists (select 1 from public.certifications);

-- Seeding is not an admin action; keep the activity log clean.
delete from public.admin_activity_logs where actor_id is null and action like '%.created';
